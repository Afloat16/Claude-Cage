package hostproxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

// Download prepares host-side application media. The caller owns staging and
// checksum verification; this transport never enters a guest environment.
func Download(ctx context.Context, address, target, name, accept string, out io.Writer) error {
	transport := NewTransport()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(req *http.Request, previous []*http.Request) error {
		if req.URL.Scheme != "https" || len(previous) >= 5 {
			return errors.New("下载重定向无效：只允许 HTTPS，最多跳转五次")
		}
		return nil
	}}
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = downloadOnce(ctx, client, address, target, name, accept, out, 60*time.Second)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err == nil {
			return err
		}
		if attempt < 2 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt+1) * time.Second):
			}
		}
	}
	// Do not include signed redirect URLs or proxy credentials in job output.
	return errors.New("主机下载失败，请检查主机代理或网络后继续安装；已有安装文件已保留")
}

func downloadOnce(parent context.Context, client *http.Client, address, target, name, accept string, out io.Writer, idle time.Duration) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil || req.URL.Scheme != "https" || req.URL.User != nil {
		return errors.New("主机安装材料必须通过 HTTPS 下载")
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	req.Header.Set("Accept-Encoding", "identity")
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载返回 HTTP %d", response.StatusCode)
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	// Check the latest activity while holding the same lock used by the body
	// reader, so a timer already queued cannot cancel a resumed stream.
	var mu sync.Mutex
	stopped := false
	last := time.Now()
	var timer *time.Timer
	var check func()
	check = func() {
		mu.Lock()
		defer mu.Unlock()
		if stopped {
			return
		}
		if remaining := idle - time.Since(last); remaining > 0 {
			timer.Reset(remaining)
		} else {
			cancel()
		}
	}
	timer = time.AfterFunc(idle, check)
	defer func() { mu.Lock(); defer mu.Unlock(); stopped = true; timer.Stop() }()
	var received int64
	total := max(response.ContentLength, 0)
	report := func() { fmt.Fprintf(out, "CAGE_HOST_BYTES %s %d %d\n", name, received, total) }
	report()
	reported := time.Now()
	buffer := make([]byte, 128<<10)
	for {
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			mu.Lock()
			last = time.Now()
			mu.Unlock()
			if _, err = file.Write(buffer[:n]); err != nil {
				return err
			}
			received += int64(n)
		}
		if time.Since(reported) >= time.Second || readErr != nil {
			report()
			reported = time.Now()
		}
		if readErr == io.EOF {
			return file.Close()
		}
		if readErr != nil {
			return readErr
		}
	}
}
