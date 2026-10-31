package workbench

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/sylvinus/agent-vm/internal/cage"
)

// Desktop returns a bootstrap URL only to the local launcher. The token stays
// in the fragment, is exchanged once the trusted UI loads, then leaves the URL.
func Desktop(configPath string) (string, error) {
	profile := filepath.Dir(configPath)
	read := func() (string, bool) {
		b, e := os.ReadFile(filepath.Join(profile, "control.json"))
		if e != nil {
			return "", false
		}
		var v controlFile
		if json.Unmarshal(b, &v) != nil || v.Port < 1024 || v.Port > 65535 || len(v.Token) != 64 {
			return "", false
		}
		origin := fmt.Sprintf("http://localhost:%d", v.Port)
		body, _ := json.Marshal(map[string]string{"token": v.Token})
		req, _ := http.NewRequest("POST", origin+"/api/launch", bytes.NewReader(body))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: time.Second, Transport: &http.Transport{Proxy: nil}}
		res, e := client.Do(req)
		if e != nil {
			return "", false
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return "", false
		}
		var response struct {
			URL string `json:"url"`
		}
		if json.NewDecoder(res.Body).Decode(&response) != nil {
			return "", false
		}
		return response.URL, true
	}
	if u, ok := read(); ok {
		return u, nil
	}
	if e := os.MkdirAll(profile, 0700); e != nil {
		return "", e
	}
	exe, e := os.Executable()
	if e != nil {
		return "", e
	}
	log, e := os.OpenFile(filepath.Join(profile, "control.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if e != nil {
		return "", e
	}
	defer log.Close()
	cmd := exec.Command(exe, "serve")
	cmd.Dir = profile
	cmd.Env = append(os.Environ(), cage.ConfigEnv+"="+configPath)
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if e = cmd.Start(); e != nil {
		return "", e
	}
	_ = cmd.Process.Release()
	for i := 0; i < 60; i++ {
		if u, ok := read(); ok {
			return u, nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return "", errors.New("工作台未能启动，请查看 ~/.claude-cage/control.log 后重试")
}
