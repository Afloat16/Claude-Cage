package workbench

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/sylvinus/agent-vm/internal/cage"
)

func failedMonitoringServer(t *testing.T) (*Server, *cage.EgressGate) {
	s, gate := grantedToolUpdateServer(t)
	s.setJobForTest(Job{})
	client, err := s.gateClient()
	if err != nil {
		t.Fatal(err)
	}
	s.finishSafetyObservation(context.Background(), client, gate.Status(), "", "guest observation timed out", true)
	if gate.Status().Mode != cage.GateClosed || s.recovery.RunID == "" {
		t.Fatal("temporary failure did not revoke and schedule")
	}
	return s, gate
}

func TestNetworkRecoveryDoesNotReusePriorGrant(t *testing.T) {
	s, gate := failedMonitoringServer(t)
	expected := s.recovery
	called := false
	err := s.runNetworkRecovery(expected, func() error {
		called = true
		if gate.Status().Mode != cage.GateClosed {
			t.Fatal("opened before full check")
		}
		return errors.New("new full check failed")
	})
	if !called || err == nil || gate.Status().Mode != cage.GateClosed || s.recovery.Attempts != 1 || !s.recovery.Next.After(time.Now().Add(20*time.Second)) {
		t.Fatal("failed check did not remain closed with backoff", err, s.recovery)
	}
}

func TestNetworkRecoveryHonorsInterveningChanges(t *testing.T) {
	for _, change := range []string{"pause", "configuration", "new-check", "stop"} {
		t.Run(change, func(t *testing.T) {
			s, gate := failedMonitoringServer(t)
			expected := s.recovery
			switch change {
			case "pause":
				if err := s.pauseNetworkNow("user pause"); err != nil {
					t.Fatal(err)
				}
			case "configuration":
				cfg, _ := loadConfig(s.configPath)
				cfg.Timezone = "Asia/Tokyo"
				if err := writePrivate(s.configPath, cfg); err != nil {
					t.Fatal(err)
				}
			case "new-check":
				if err := gate.BeginCheck(); err != nil {
					t.Fatal(err)
				}
			case "stop":
				s.closing = true
			}
			err := s.runNetworkRecovery(expected, func() error { t.Fatal("stale recovery ran"); return nil })
			if !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if s.recovery.RunID != "" {
				t.Fatal("stale recovery retained")
			}
		})
	}
}

func TestNetworkRecoverySuccessfulFullCheckClearsRetry(t *testing.T) {
	s, gate := failedMonitoringServer(t)
	expected := s.recovery
	err := s.runNetworkRecovery(expected, func() error {
		if err := gate.BeginCheck(); err != nil {
			return err
		}
		state := gate.Status()
		report := *state.Report
		report.CheckID = state.CheckID
		report.ID = "fresh-recovery"
		report.CreatedAt = time.Now()
		for i := range report.Checks {
			report.Checks[i].CheckedAt = report.CreatedAt
		}
		return gate.Grant(report)
	})
	if err != nil || gate.Status().Mode != cage.GateOpen || s.recovery.RunID != "" {
		t.Fatal(err, gate.Status().Mode, s.recovery)
	}
}

func TestConfigurationMismatchDoesNotScheduleRecovery(t *testing.T) {
	s, gate := grantedToolUpdateServer(t)
	s.setJobForTest(Job{})
	state := gate.Status()
	cfg, _ := loadConfig(s.configPath)
	cfg.Timezone = "Asia/Tokyo"
	if err := writePrivate(s.configPath, cfg); err != nil {
		t.Fatal(err)
	}
	client, _ := s.gateClient()
	s.finishSafetyObservation(context.Background(), client, state, "", "guest observation timed out", true)
	if s.recovery.RunID != "" || gate.Status().Mode != cage.GateClosed {
		t.Fatal("configuration change got transient recovery")
	}
}
