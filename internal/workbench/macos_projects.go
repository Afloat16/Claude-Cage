package workbench

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"al.essio.dev/pkg/shellescape"
)

func macOSProjectPath(user, hostDirectory string) string {
	digest := sha256.Sum256([]byte(hostDirectory))
	return path.Join("/Users", user, "Cage", "Projects", fmt.Sprintf("%x", digest[:12]))
}

// A mount which is ready in FSKit can still be unreadable by the guest app.
// Keep the live restricted connection while macOS waits for the user's folder
// approval; do not accept an APFS directory or a stale mount as this project.
var errMacOSProjectApproval = errors.New("请在虚拟 Mac 的项目授权窗口中选中此项目，然后重新打开")

const macProjectAgent = "/Applications/CageProjectAccess.app/Contents/MacOS/CageProjectAccess"

func (s *Server) ensureMacOSProjectShare(hostDir string) error {
	ctx, cancel := context.WithTimeout(s.operationContext(), 18*time.Second)
	defer cancel()
	guestDir := macOSProjectPath(s.macosGuest.User, hostDir)
	s.mu.Lock()
	share := s.projectShares[hostDir]
	s.mu.Unlock()
	if share != nil {
		select {
		case <-share.done:
			share.close()
			share = nil
		default:
		}
	}
	if share == nil {
		var err error
		share, err = s.startMacOSProjectShare(ctx, hostDir, guestDir)
		if err != nil {
			return err
		}
		s.mu.Lock()
		if s.projectShares == nil {
			s.projectShares = make(map[string]*projectShare)
		}
		s.projectShares[hostDir] = share
		s.mu.Unlock()
	}
	err := s.probeMacOSProject(ctx, hostDir, guestDir, share)
	if err == nil && share.detach == nil {
		// FSKit assigns an independent volume UUID after mount. Pin the volume
		// only after the signed-in app returned this host directory's challenge.
		share.detach, err = s.macOSMountCleanup(ctx, guestDir)
	}
	if errors.Is(err, errMacOSProjectApproval) {
		s.beginMacOSProjectApproval(hostDir, share)
	} else if err == nil {
		s.mu.Lock()
		share.approval = ""
		if share.approvalTimer != nil {
			share.approvalTimer.Stop()
			share.approvalTimer = nil
		}
		s.mu.Unlock()
	}
	if err != nil && !errors.Is(err, errMacOSProjectApproval) {
		share.close()
		s.mu.Lock()
		delete(s.projectShares, hostDir)
		s.mu.Unlock()
	}
	return err
}

func (s *Server) startMacOSProjectShare(ctx context.Context, hostDir, guestDir string) (*projectShare, error) {
	folder := shellescape.Quote(guestDir)

	prepare := `set -e; test "$(/usr/bin/stat -f %u /dev/console)" = "$(/usr/bin/id -u)" || exit 73
		/bin/launchctl print "gui/$(/usr/bin/id -u)" >/dev/null 2>&1 || exit 73
		test -x /usr/local/libexec/cage-sshfs; test -x ` + macProjectAgent +
		`; p=` + folder + `; if /sbin/mount | /usr/bin/grep -Fq " on $p ("; then exit 2; fi; for d in "$HOME/Cage" "$HOME/Cage/Projects" "$p"; do
		test ! -L "$d"; if test ! -e "$d"; then /bin/mkdir -m 700 "$d"; fi; test -d "$d" && test -O "$d" || exit 1
	done; test -z "$(/bin/ls -A "$p")"; /usr/bin/open -gj -a /Applications/CageProjectAccess.app`
	_, err := s.guestControl(ctx, prepare, "macos-project-prepare")
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 73 {
			return nil, errors.New("请先在虚拟 Mac 中登录已绑定的普通账户，再重新打开项目")
		}
		return nil, errors.New("无法准备 macOS 实时挂载。请检查客机项目助手、SSHFS 及目标目录")
	}
	command := "exec /usr/local/libexec/cage-sshfs " + shellescape.Quote(":"+filepath.ToSlash(hostDir)) + " " + folder +
		" -f -o slave,backend=fskit,nodev,nosuid,dir_cache=no"
	conn, err := startProjectTransport(s.sshCommand(s.lifetimeContext(), "-T", s.sshTarget(), "--", command), hostDir)
	if err != nil {
		return nil, err
	}

	return conn, nil
}

func (s *Server) macOSMountCleanup(ctx context.Context, guestDir string) (func(), error) {
	query := "/sbin/mount | /usr/bin/grep -F -- " + shellescape.Quote(" on "+guestDir+" (")
	out, err := s.guest(ctx, query)
	line := strings.TrimSpace(string(out))
	device, options, ok := strings.Cut(line, " on "+guestDir+" (")
	id := strings.TrimPrefix(device, "macfuse://")
	if _, parseErr := uuid.Parse(id); err != nil || !ok || id == device || parseErr != nil || strings.Contains(line, "\n") ||
		!strings.Contains(options, "fskit") || !strings.Contains(options, "mounted by "+s.macosGuest.User+")") {
		return nil, errors.New("无法核对本次挂载的 macOS 卷标识")
	}
	detach := "if test \"$(" + query + ")\" = " + shellescape.Quote(line) + "; then /sbin/umount -f " + shellescape.Quote(guestDir) + "; fi"
	return func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = s.guest(cleanup, detach)
	}, nil
}

func (s *Server) probeMacOSProject(ctx context.Context, hostDir, guestDir string, share *projectShare) error {
	probe, err := os.CreateTemp(hostDir, ".cage-mount-probe-*")
	if err != nil {
		return err
	}
	defer os.Remove(probe.Name())
	challenge := randomToken()
	_, writeErr := probe.WriteString(challenge)
	if err := errors.Join(writeErr, probe.Close()); err != nil {
		return err
	}
	cmd := shellescape.QuoteCommand([]string{macProjectAgent, "probe", guestDir, filepath.Base(probe.Name()), challenge})
	for {
		output, err := s.guest(ctx, cmd)
		if err == nil && strings.TrimSpace(string(output)) == "OK" {
			return nil
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 75 {
			return errMacOSProjectApproval
		}
		select {
		case <-ctx.Done():
			return errors.New("虚拟 Mac 的项目助手未能读回宿主项目文件")
		case <-share.done:
			return errors.New("macOS 实时挂载已断开，请检查客机文件系统扩展授权")
		case <-time.After(200 * time.Millisecond):
		}
	}
}
