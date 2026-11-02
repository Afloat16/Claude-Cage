package workbench

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"
)

var errTerminalInputFull = errors.New("terminal input queue is full")

type terminalPTY interface {
	io.ReadWriteCloser
	Resize(cols, rows uint16) error
	Wait() error
	Kill() error
}

type terminalSession struct {
	mu        sync.Mutex
	id, title string
	workspace string
	cmd       *exec.Cmd
	file      terminalPTY
	history   []byte
	closed    bool
	clients   map[chan []byte]bool
	done      chan struct{}
	inputs    chan string
	stopping  chan struct{}
	closeOnce sync.Once
}

func newTerminalSession(file terminalPTY) *terminalSession {
	return &terminalSession{file: file, clients: map[chan []byte]bool{}, done: make(chan struct{}), inputs: make(chan string, 8), stopping: make(chan struct{})}
}

func (t *terminalSession) summary() map[string]any {
	t.mu.Lock()
	defer t.mu.Unlock()
	return map[string]any{"id": t.id, "title": t.title, "closed": t.closed, "workspace": t.workspace}
}

func (t *terminalSession) stopPTY() {
	t.closeOnce.Do(func() {
		t.mu.Lock()
		t.closed = true
		t.mu.Unlock()
		if t.stopping != nil {
			close(t.stopping)
		}
		if t.file != nil {
			// Close may wait inside ConPTY. Never hold the session mutex while
			// the reader needs it to drain the final output and finish.
			_ = t.file.Kill()
			_ = t.file.Close()
		}
	})
}

func (t *terminalSession) close() {
	t.stopPTY()
	if t.done != nil {
		<-t.done
	}
}

// Input belongs to the session once admitted. A viewer never waits inside a
// PTY write, so disconnecting or locking the account can drain its handler
// while a guest process is not reading input. A full queue rejects the viewer
// immediately, so the handler never waits to read a WebSocket close either.
func (t *terminalSession) enqueueInput(ctx context.Context, input string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return os.ErrClosed
	}
	select {
	case t.inputs <- input:
		return nil
	default:
		return errTerminalInputFull
	}
}

func (t *terminalSession) writeInput() {
	for {
		select {
		case <-t.stopping:
			return
		case input := <-t.inputs:
			if _, err := io.WriteString(t.file, input); err != nil {
				t.stopPTY()
				return
			}
		}
	}
}

type terminalSubscription struct {
	History []byte
	Output  <-chan []byte
	session *terminalSession
	channel chan []byte
}

// subscribe captures history and registers live output under the same lock.
// Every byte belongs to exactly one side of this history/live boundary.
func (t *terminalSession) subscribe() *terminalSubscription {
	t.mu.Lock()
	defer t.mu.Unlock()
	channel := make(chan []byte, 64)
	if t.closed {
		close(channel)
	} else {
		t.clients[channel] = true
	}
	return &terminalSubscription{History: append([]byte(nil), t.history...), Output: channel, session: t, channel: channel}
}

// Close detaches the viewer; the PTY and its process continue running.
func (s *terminalSubscription) Close() {
	s.session.mu.Lock()
	defer s.session.mu.Unlock()
	if s.session.clients[s.channel] {
		delete(s.session.clients, s.channel)
		close(s.channel)
	}
}

func (t *terminalSession) run() {
	writerDone := make(chan struct{})
	go func() { defer close(writerDone); t.writeInput() }()
	t.read()
	// An SSH process can remain alive after its output side closes. Once no
	// output can be read, terminate and reap it before completing the session.
	t.stopPTY()
	_ = t.file.Wait()
	<-writerDone
	// Admission is sealed under mu before stopping the writer. Release queued
	// input even when the closed terminal remains visible with its history.
	for len(t.inputs) > 0 {
		<-t.inputs
	}
	t.mu.Lock()
	for channel := range t.clients {
		close(channel)
		delete(t.clients, channel)
	}
	t.mu.Unlock()
	close(t.done)
}

func (t *terminalSession) read() {
	buffer := make([]byte, 16<<10)
	for {
		n, err := t.file.Read(buffer)
		if n > 0 {
			chunk := append([]byte(nil), buffer[:n]...)
			t.mu.Lock()
			t.history = append(t.history, chunk...)
			if len(t.history) > 512<<10 {
				t.history = t.history[len(t.history)-(512<<10):]
			}
			for channel := range t.clients {
				select {
				case channel <- chunk:
				default:
					close(channel)
					delete(t.clients, channel)
				}
			}
			t.mu.Unlock()
		}
		if err != nil {
			break
		}
	}
}
