package workbench

import (
	"errors"
	"fmt"
	"os/exec"
	"sync"

	"al.essio.dev/pkg/shellescape"
	"github.com/sylvinus/agent-vm/internal/vmname"
)

var (
	errTerminalsClosed  = errors.New("后台正在退出，请重新打开 Cage。")
	errTerminalBusy     = errors.New("环境正在执行其他操作")
	errTerminalNotReady = errors.New("环境尚未就绪或正在重启")
	errTerminalLimit    = errors.New("最多保留 12 个终端，请先关闭不用的会话")
	errTerminalStart    = errors.New("无法创建终端连接")
)

type terminalRequest struct {
	Workspace string `json:"workspace"`
	Kind      string `json:"kind"`
}

// terminalManager owns host PTYs; subscriptions only borrow their output. The
// manager serializes process creation with closure so no process can be
// published after shutdown has collected the sessions it needs to close.
type terminalManager struct {
	mu       sync.Mutex
	sessions map[string]*terminalSession
	sequence int
	closed   bool
	workers  sync.WaitGroup
}

func (m *terminalManager) start(cmd *exec.Cmd, workspace, kind string) (*terminalSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.admissionErrorLocked(); err != nil {
		return nil, err
	}
	file, err := startTerminal(cmd, 100, 30)
	if err != nil {
		return nil, errTerminalStart
	}
	m.sequence++
	title := fmt.Sprintf("终端 %d", m.sequence)
	if kind == "claude" {
		title = fmt.Sprintf("Claude %d", m.sequence)
	}
	session := newTerminalSession(file)
	session.id, session.title, session.workspace, session.cmd = randomToken()[:16], title, workspace, cmd
	if m.sessions == nil {
		m.sessions = make(map[string]*terminalSession)
	}
	m.sessions[session.id] = session
	m.workers.Add(1)
	go func() { defer m.workers.Done(); session.run() }()
	return session, nil
}

func (m *terminalManager) admissionErrorLocked() error {
	if m.closed {
		return errTerminalsClosed
	}
	if len(m.sessions) >= 12 {
		return errTerminalLimit
	}
	return nil
}

func (m *terminalManager) canStart() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.admissionErrorLocked()
}

func (m *terminalManager) snapshot() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]map[string]any, 0, len(m.sessions))
	for _, session := range m.sessions {
		out = append(out, session.summary())
	}
	return out
}

func (m *terminalManager) hasLive() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, session := range m.sessions {
		session.mu.Lock()
		closed := session.closed
		session.mu.Unlock()
		if !closed {
			return true
		}
		if session.done != nil {
			select {
			case <-session.done:
			default:
				return true
			}
		}
	}
	return false
}

func (m *terminalManager) get(id string) *terminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *terminalManager) remove(id string) {
	m.mu.Lock()
	session := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if session != nil {
		session.close()
	}
}

// closeAll keeps ended sessions visible until explicitly removed and permits
// new terminals after the environment starts again. Environment operations
// serialize this call with createTerminal using Server.op.
func (m *terminalManager) closeAll() {
	m.mu.Lock()
	sessions := make([]*terminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()
	for _, session := range sessions {
		session.close()
	}
}

func (m *terminalManager) close() {
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
	m.closeAll()
	// A remove may already have taken a session out of the map while its
	// process is still exiting. Admission is sealed, so waiting is safe.
	m.workers.Wait()
}

func (s *Server) createTerminal(input terminalRequest) (*terminalSession, error) {
	if !s.op.TryLock() {
		return nil, errTerminalBusy
	}
	defer s.op.Unlock()
	s.mu.Lock()
	closing := s.closing
	command := claudeTerminalCommand(s.preferences)
	s.mu.Unlock()
	if closing {
		return nil, errTerminalsClosed
	}
	if !s.vmRunning() || s.busy() {
		return nil, errTerminalNotReady
	}
	// Reject a full manager before opening project shares. start checks again
	// atomically with process publication because shutdown can race this work.
	if err := s.terminals.canStart(); err != nil {
		return nil, err
	}
	if input.Kind != "" && input.Kind != "shell" && input.Kind != "claude" {
		return nil, errors.New("终端类型无效")
	}
	workspace, err := s.connectProject(input.Workspace, false)
	if err != nil {
		return nil, err
	}
	name := vmname.Name(s.environmentDir())
	script := terminalScript(guestPath(workspace), input.Kind, command)
	cmd := s.sshCommand(s.lifetimeContext(), "-tt", "lima-"+name, "--", script)
	return s.terminals.start(cmd, workspace, input.Kind)
}

// The saved command is interpreted only by the guest's interactive shell.
// Reconnecting a viewer never executes it again; exiting Claude leaves a shell.
func terminalScript(workspace, kind, command string) string {
	prefix := "cd " + shellescape.Quote(workspace) + " && exec env TERM=xterm-256color COLORTERM=truecolor CAGE_WORKBENCH=1 "
	if kind != "claude" {
		return prefix + "bash -l"
	}
	return prefix + "CAGE_TERMINAL_COMMAND=" + shellescape.Quote(command) + " bash -lic " + shellescape.Quote("eval \"$CAGE_TERMINAL_COMMAND\"; unset CAGE_TERMINAL_COMMAND; exec bash -il")
}
