package workbench

import (
	"context"
	"path/filepath"

	"github.com/sylvinus/agent-vm/internal/managedproxy"
)

var physicalProxyInterface = managedproxy.PhysicalInterface

// The lifecycle lock is held by monitorNetwork. Schedule a regular job so a
// user stop can cancel recovery and pause can still revoke the gate immediately.
func (s *Server) monitorProxyInterface() {
	if s.busy() {
		return
	}
	cfg, err := loadConfig(s.configPath)
	if err != nil || (cfg.ProxyRevision == "" && !s.usesManagedProxy(cfg)) || !proxyListening(cfg) {
		return
	}
	name, err := physicalProxyInterface(context.Background())
	if err != nil {
		_ = s.closeProxyGate(err.Error())
		s.mu.Lock()
		s.networkError = err.Error()
		s.proxyNetworkLost = true
		s.mu.Unlock()
		return
	}
	s.mu.Lock()
	lost := s.proxyNetworkLost
	s.mu.Unlock()
	bound, err := managedproxy.BoundInterface(filepath.Join(managedproxy.Dir(s.profile), "config.yaml"))
	if err != nil || (bound == name && !lost) {
		return
	}
	// Revoke the previous report before the asynchronous recovery can start.
	if err := s.closeProxyGate("物理网卡已变化，正在重新绑定代理并检查出口"); err != nil {
		return
	}
	s.mu.Lock()
	s.proxyNetworkLost = false
	s.mu.Unlock()
	s.launch(&discardResponse{}, "proxy-network", s.rebindProxyInterface)
}

func (s *Server) rebindProxyInterface() error {
	s.setMessage("正在识别物理网卡并重新绑定代理…")
	cfg, err := loadConfig(s.configPath)
	if err != nil {
		return err
	}
	if cfg.ProxyRevision != "" {
		p, err := managedproxy.Load(s.profile)
		if err != nil {
			return err
		}
		return s.applyProxy(p, cfg, false)
	}
	// Also discard old sockets after a disconnected uplink returns under the
	// same interface name. The guest VM and its local services stay alive.
	if err := s.runCage("proxy-stop"); err != nil {
		return err
	}
	if err := s.runCage("proxy-start"); err != nil {
		return err
	}
	s.mu.Lock()
	paused := s.networkPaused
	s.mu.Unlock()
	if !paused && s.vmRunning() {
		return s.runSafetyCheck()
	}
	return nil
}
