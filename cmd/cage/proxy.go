package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"context"
	"github.com/sylvinus/agent-vm/internal/cage"
	"github.com/sylvinus/agent-vm/internal/managedproxy"
)

// The imported chain is a private launchd job. It is not installed as a login
// item and does not alter the system proxy or the user's Clash instance.
func proxyCommand(command, profile string, cfg cage.Config) error {
	if command != "proxy-legacy-stop" {
		if _, err := os.Stat(filepath.Join(managedproxy.Dir(profile), "sources.json")); err == nil {
			if command == "proxy-stop" {
				if err := closeManagedGates(profile); err != nil {
					return err
				}
				return managedproxy.Stop(profile)
			}
			p, err := managedproxy.Load(profile)
			if err != nil {
				return err
			}
			if cfg.ProxyRevision == "" || cfg.ProxyURL != p.Endpoint() || cfg.ProxyRevision != p.Revision {
				return errors.New("请在 Cage 的网络与代理页面选择并应用节点")
			}
			name, err := managedproxy.PhysicalInterface(context.Background())
			if err != nil {
				_ = closeManagedGates(profile)
				return err
			}
			bound, _ := managedproxy.BoundInterface(filepath.Join(managedproxy.Dir(profile), "config.yaml"))
			if bound == name && managedproxy.Running(context.Background(), profile, p) {
				return nil
			}
			if err := closeManagedGates(profile); err != nil {
				return err
			}
			p.Revision = managedproxy.Token()
			cfg.ProxyRevision = p.Revision
			if err := p.Save(profile); err != nil {
				return err
			}
			data, _ := json.MarshalIndent(cfg, "", "  ")
			configPath := os.Getenv(cage.ConfigEnv)
			if configPath == "" {
				configPath = filepath.Join(profile, "config.json")
			}
			if err := managedproxy.Write(configPath, data); err != nil {
				return err
			}
			files, _ := filepath.Glob(filepath.Join(profile, "state", "lima", "*", "cage-gate.json"))
			for _, file := range files {
				if client, e := cage.OpenGateClient(filepath.Dir(file)); e == nil {
					if _, e = client.Status(context.Background()); e == nil {
						if _, e = client.SyncProxyRevision(context.Background()); e != nil {
							return e
						}
					}
				}
			}
			return managedproxy.Start(context.Background(), profile, p)
		}
	}
	if runtime.GOOS != "darwin" {
		return errors.New("managed proxy start/stop currently requires macOS; external proxies work on other hosts")
	}
	dir := filepath.Join(profile, "proxy")
	label := "local.claude-cage.proxy." + cfg.Fingerprint()[:12]
	domain := "gui/" + strconv.Itoa(os.Getuid())
	plist := filepath.Join(dir, "service.plist")
	if command == "proxy-stop" || command == "proxy-legacy-stop" {
		if err := closeManagedGates(profile); err != nil {
			return err
		}
		cmd := exec.Command("launchctl", "bootout", domain, plist)
		if cmd.Run() != nil {
			return errors.New("could not stop cage proxy job; it may already be stopped")
		}
		fmt.Println("Cage proxy stopped. Guest external requests will fail.")
		return nil
	}
	b, err := os.ReadFile(filepath.Join(dir, "runner.json"))
	if err != nil {
		return errors.New("no imported proxy runner; use scripts/cage-import-clash.py first")
	}
	var runner struct {
		Executable string `json:"executable"`
	}
	if json.Unmarshal(b, &runner) != nil || !filepath.IsAbs(runner.Executable) {
		return errors.New("invalid proxy runner file")
	}
	if _, err := os.Stat(runner.Executable); err != nil {
		return errors.New("proxy core executable is unavailable")
	}
	endpoint, _ := url.Parse(cfg.ProxyURL)
	if !net.ParseIP(endpoint.Hostname()).IsLoopback() {
		return errors.New("managed proxy requires a loopback proxy endpoint")
	}
	name, err := managedproxy.PhysicalInterface(context.Background())
	if err != nil {
		_ = closeManagedGates(profile)
		return err
	}
	configPath := filepath.Join(dir, "config.yaml")
	bound, err := managedproxy.BoundInterface(configPath)
	if err != nil {
		return err
	}
	// Re-evaluate the host uplink even when launchd already has the core loaded.
	// Never keep a stale manual en0 binding after switching to Ethernet.
	if bound != name {
		if err := closeManagedGates(profile); err != nil {
			return err
		}
		_ = exec.Command("launchctl", "bootout", domain, plist).Run()
		data, err := os.ReadFile(configPath)
		if err != nil {
			return err
		}
		data, err = managedproxy.BindInterface(data, name)
		if err != nil {
			return err
		}
		if err = managedproxy.Write(configPath, data); err != nil {
			return err
		}
	}
	// A timezone or language change must not orphan the already loaded proxy.
	// The prior label is read only from this profile's private launchd plist.
	if previous, e := exec.Command("/usr/libexec/PlistBuddy", "-c", "Print :Label", plist).Output(); e == nil {
		priorLabel := strings.TrimSpace(string(previous))
		if strings.HasPrefix(priorLabel, "local.claude-cage.proxy.") && exec.Command("launchctl", "print", domain+"/"+priorLabel).Run() == nil {
			fmt.Println("Cage proxy job is already loaded.")
			return nil
		}
	}
	if exec.Command("launchctl", "print", domain+"/"+label).Run() == nil {
		fmt.Println("Cage proxy job is already loaded.")
		return nil
	}
	if conn, err := net.DialTimeout("tcp", endpoint.Host, time.Second); err == nil {
		conn.Close()
		return errors.New("the configured proxy port is already in use; refusing to replace another listener")
	}
	escape := func(s string) string { var b bytes.Buffer; xml.EscapeText(&b, []byte(s)); return b.String() }
	content := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>%s</string>
<key>ProgramArguments</key><array><string>%s</string><string>-d</string><string>%s</string><string>-f</string><string>%s</string></array>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>%s</string>
<key>StandardErrorPath</key><string>%s</string>
</dict></plist>`, escape(label), escape(runner.Executable), escape(dir), escape(filepath.Join(dir, "config.yaml")), escape(filepath.Join(dir, "runtime.log")), escape(filepath.Join(dir, "runtime.log")))
	// Remove only our prior job at this exact private profile path.
	_ = exec.Command("launchctl", "bootout", domain, plist).Run()
	if err := os.WriteFile(plist, []byte(content), 0600); err != nil {
		return err
	}
	if err := exec.Command("launchctl", "bootstrap", domain, plist).Run(); err != nil {
		return errors.New("could not start cage proxy job")
	}
	ready := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		conn, err := net.DialTimeout("tcp", endpoint.Host, 200*time.Millisecond)
		if err == nil {
			conn.Close()
			ready = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		return errors.New("cage proxy job did not open its listener; inspect the private proxy runtime log")
	}
	fmt.Println("Cage proxy started. Run cage check to verify the selected node.")
	return nil
}

func closeManagedGates(profile string) error {
	files, _ := filepath.Glob(filepath.Join(profile, "state", "lima", "*", "cage-gate.json"))
	for _, file := range files {
		if client, e := cage.OpenGateClient(filepath.Dir(file)); e == nil {
			if _, e = client.Status(context.Background()); e == nil {
				if _, e = client.Close(context.Background(), "代理核心停止或重启，等待重新检测"); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
