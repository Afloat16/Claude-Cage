package workbench

import (
	"context"
	_ "embed"
	"errors"
	"strings"
	"time"
)

//go:embed macos_extension_probe.pl
var macOSProbeFSKit string

func (s *Server) checkMacOSSetupProjects(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	cmd := s.macOSSSHCommand(ctx, "-T", s.sshTarget(), "--", "exec /usr/bin/perl -")
	cmd.Stdin = strings.NewReader(macOSProbeFSKit)
	err := cmd.Run()
	s.mu.Lock()
	if err != nil {
		s.macSetupProjectsChecked = time.Time{}
	} else {
		s.macSetupProjectsChecked = time.Now()
	}
	s.mu.Unlock()
	if err != nil {
		return errors.New("尚未能挂载并卸载只读测试卷。请在客机设置的 By Category（按类别）→ File System Extensions（文件系统扩展）中启用 macFUSE 和 macFUSE (local)，再点验证")
	}
	return nil
}
