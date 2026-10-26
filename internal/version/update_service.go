package version

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHelperAckTimeout     = 10 * time.Second
	defaultHelperHandoffTimeout = 30 * time.Second
	maxHelperTransactionTime    = 10 * time.Minute
)

// SystemdUpdateService identifies the original service, never the transient
// updater unit. The replacement must be started by this manager, not as the
// updater's child (which would be killed when the transient unit finishes).
type SystemdUpdateService struct {
	Unit string `json:"unit"`
	User bool   `json:"user,omitempty"`
}

func validServiceUnit(unit string) bool {
	if !strings.HasSuffix(unit, ".service") || len(unit) > 200 || unit == ".service" {
		return false
	}
	for _, c := range unit {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("_.:@-\\", c)) {
			return false
		}
	}
	return unit[0] != '-'
}

func serviceFromCgroup(data string) *SystemdUpdateService {
	for _, line := range strings.Split(data, "\n") {
		fields := strings.SplitN(strings.TrimSpace(line), ":", 3)
		if len(fields) != 3 || (fields[1] != "" && fields[1] != "name=systemd") {
			continue
		}
		parts := strings.Split(strings.Trim(fields[2], "/"), "/")
		unit := parts[len(parts)-1]
		if !validServiceUnit(unit) {
			continue
		}
		service := &SystemdUpdateService{Unit: unit}
		for _, parent := range parts[:len(parts)-1] {
			if strings.HasPrefix(parent, "user@") && strings.HasSuffix(parent, ".service") {
				service.User = true
			}
		}
		return service
	}
	return nil
}

func currentUpdateService() (*SystemdUpdateService, error) {
	if runtime.GOOS != "linux" {
		return nil, nil
	}
	data, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return nil, fmt.Errorf("inspect update service cgroup: %w", err)
	}
	service := serviceFromCgroup(string(data))
	if service == nil && os.Getenv("INVOCATION_ID") != "" {
		return nil, errors.New("cannot identify the current systemd service; refusing an unsafe update handoff")
	}
	return service, nil
}

func sameUpdateService(a, b *SystemdUpdateService) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func systemdRunArgs(manifest UpdateManifest, helperPath, manifestPath string) []string {
	args := []string{"--no-ask-password", "--no-block", "--quiet", "--collect"}
	if manifest.Systemd.User {
		args = append(args, "--user")
		// User-manager services need the same bus address for subsequent
		// systemctl --user calls. No application credentials are forwarded.
		for _, key := range []string{"XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"} {
			if value := os.Getenv(key); value != "" {
				args = append(args, "--setenv="+key+"="+value)
			}
		}
	}
	args = append(args,
		"--unit=ga-admin-updater-"+manifest.OperationID+".service",
		"--property=Type=oneshot",
		"--property=TimeoutStartSec=0",
		"--property=KillMode=control-group",
		"--property=UMask=0077",
		"--property=WorkingDirectory="+manifest.WorkingDir,
		"--", helperPath, "--update-helper", manifestPath,
	)
	return args
}

func runServiceCommand(timeout time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		message := strings.TrimSpace(string(output))
		if len(message) > 4096 {
			message = message[:4096]
		}
		return nil, fmt.Errorf("%s: %w (%s)", name, err, message)
	}
	return output, nil
}

func systemctlArgs(service *SystemdUpdateService, action string) []string {
	args := []string{"--no-ask-password"}
	if service.User {
		args = append(args, "--user")
	}
	args = append(args, action)
	if action == "show" {
		args = append(args, "--property=MainPID", "--value")
	}
	return append(args, service.Unit)
}

func controlUpdateService(manifest UpdateManifest, action string) error {
	if action != "stop" && action != "start" {
		return fmt.Errorf("unsupported update service action %q", action)
	}
	_, err := runServiceCommand(manifest.ExitTimeout, "systemctl", systemctlArgs(manifest.Systemd, action)...)
	return err
}

func updateServicePID(manifest UpdateManifest) (int, error) {
	output, err := runServiceCommand(5*time.Second, "systemctl", systemctlArgs(manifest.Systemd, "show")...)
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(output)))
	if err != nil || pid <= 0 {
		return 0, fmt.Errorf("service %s has no running MainPID (%q)", manifest.Systemd.Unit, strings.TrimSpace(string(output)))
	}
	return pid, nil
}

func launchPreparedUpdateHelper(helperPath, manifestPath string) error {
	manifest, err := readUpdateManifest(manifestPath)
	if err != nil {
		return err
	}
	service, err := currentUpdateService()
	if err != nil {
		return err
	}
	if !sameUpdateService(service, manifest.Systemd) {
		return errors.New("prepared update belongs to a different service; prepare the update again")
	}
	if manifest.OldPID != os.Getpid() {
		return errors.New("prepared update belongs to a previous process; prepare the update again")
	}
	if manifest.Systemd != nil {
		// Never fall back to Setsid here: it does not escape a service cgroup.
		_, err := runServiceCommand(defaultHelperAckTimeout, "systemd-run", systemdRunArgs(manifest, helperPath, manifestPath)...)
		return err
	}
	cmd := exec.Command(helperPath, "--update-helper", manifestPath)
	cmd.Dir = filepath.Dir(helperPath)
	detachUpdateProcess(cmd)
	hideChildWindow(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func waitForHelperAck(operationID string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		st := CurrentUpdateStatus()
		if st.ID != operationID {
			return ErrUpdateSuperseded
		}
		if st.Running && st.Stage == "waiting_for_exit" && st.HelperPID > 0 && !st.HelperStartedAt.IsZero() && !st.WaitingAt.IsZero() {
			return nil
		}
		if !st.Running || st.Stage != "starting_helper" {
			return fmt.Errorf("helper did not acknowledge the handoff: stage %q: %s", st.Stage, st.Error)
		}
		if !time.Now().Before(deadline) {
			return errors.New("update helper startup acknowledgement timed out; original service was not stopped")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func waitForHelperHandoff(manifest UpdateManifest) error {
	deadline := time.Now().Add(defaultHelperHandoffTimeout)
	for {
		st := CurrentUpdateStatus()
		if st.ID != manifest.OperationID || !st.Running || st.Stage != "waiting_for_exit" || st.HelperPID != os.Getpid() {
			return ErrUpdateSuperseded
		}
		if !st.HandoffAt.IsZero() {
			return nil
		}
		if !time.Now().Before(deadline) {
			return errors.New("original process did not authorize the acknowledged update handoff")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func startHelperHeartbeat(operationID string) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if err := transitionUpdate(operationID, func(st *UpdateStatus) error {
					if !st.Running || st.HelperPID != os.Getpid() {
						return ErrUpdateSuperseded
					}
					st.HelperHeartbeatAt = time.Now()
					return nil
				}); err != nil {
					return
				}
			}
		}
	}()
	return func() { close(stop); <-done }
}

func failUnstartedHandoff(manifest UpdateManifest, cause error) error {
	persistErr := transitionUpdate(manifest.OperationID, func(st *UpdateStatus) error {
		// A failed authorization may already have restored ready, or a retry
		// may have claimed a different helper. Do not overwrite either.
		if !st.Running || st.Stage != "waiting_for_exit" || st.HelperPID != os.Getpid() || !st.HandoffAt.IsZero() {
			return ErrUpdateSuperseded
		}
		st.Stage = "ready"
		st.Progress = 90
		st.Message = "update handoff was not authorized; original service was not stopped"
		st.Error = cause.Error()
		st.HelperPID = 0
		return nil
	})
	if persistErr != nil && !errors.Is(persistErr, ErrUpdateSuperseded) {
		return errors.Join(cause, persistErr)
	}
	return cause
}

func waitForServiceReplacementConfirmation(manifest UpdateManifest, newPID int, deps transactionDeps) error {
	deadline := time.Now().Add(manifest.ConfirmTimeout)
	var stableSince time.Time
	for {
		st := CurrentUpdateStatus()
		if st.ID != manifest.OperationID {
			return ErrUpdateSuperseded
		}
		if !st.Running || (st.Stage != "starting_replacement" && st.Stage != "replacement_ready") {
			return fmt.Errorf("replacement confirmation stopped during stage %q: %s", st.Stage, st.Error)
		}
		pid, err := deps.servicePID(manifest)
		if err != nil {
			return fmt.Errorf("replacement service is not running: %w", err)
		}
		if pid != newPID {
			return fmt.Errorf("replacement service PID changed from %d to %d before commit", newPID, pid)
		}
		if st.Stage == "replacement_ready" {
			if st.NewPID != newPID || st.ConfirmedVersion != manifest.TargetVersion {
				return errors.New("replacement service confirmation does not match the launched PID and version")
			}
			if stableSince.IsZero() {
				stableSince = time.Now()
			}
			if time.Since(stableSince) >= manifest.StabilityTime {
				return nil
			}
		} else if !time.Now().Before(deadline) {
			return errors.New("replacement service startup confirmation timed out")
		}
		deps.sleep(50 * time.Millisecond)
	}
}

// Reads may close an abandoned transaction, but must never guess that a
// partially installed update succeeded or modify files while the helper lives.
func normalizeInterruptedUpdate(st UpdateStatus, now time.Time) UpdateStatus {
	if !st.Running {
		return st
	}
	switch st.Stage {
	case "starting_helper", "waiting_for_exit", "applying", "starting_replacement", "replacement_ready", "restarting", "rolling_back":
	default:
		return st
	}
	last := st.HelperHeartbeatAt
	if last.IsZero() {
		last = st.UpdatedAt
	}
	if last.IsZero() || now.Sub(last) < defaultHelperHandoffTimeout {
		return st
	}
	reason := ""
	if st.HelperPID <= 0 {
		reason = "update helper never acknowledged startup"
	} else if waitForPIDExit(st.HelperPID, 0) == nil {
		reason = "update helper exited before the transaction committed"
	}
	if reason == "" {
		return st
	}
	st.RollbackResult = "not_started"
	if st.Stage != "starting_helper" && st.Stage != "waiting_for_exit" {
		st.RollbackResult = "manual_recovery_required: inspect operation-scoped backups before retrying"
	}
	st.Running = false
	st.Stage = "failed"
	st.Progress = 100
	st.Error = reason
	st.Message = reason
	st.EndedAt = now
	return st
}

// Called after binding the listener when systemd starts the replacement with
// the original ExecStart (which intentionally has no per-update CLI flags).
func ConfirmPendingServiceUpdateReady() error {
	st := CurrentUpdateStatus()
	if !st.Running || st.Stage != "starting_replacement" {
		return nil
	}
	service, err := currentUpdateService()
	if err != nil {
		return err
	}
	if service == nil {
		return nil
	}
	ready, manifest, err := readReadyUpdate()
	if err != nil {
		return err
	}
	if ready.OperationID != st.ID || !sameUpdateService(service, manifest.Systemd) || st.HandoffAt.IsZero() {
		return errors.New("pending update does not belong to the current service handoff")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if !sameFilePath(exe, manifest.OriginalExe) || manifest.OldPID == os.Getpid() {
		return errors.New("pending service update has an unexpected replacement executable or PID")
	}
	return ConfirmUpdateReady(st.ID)
}
