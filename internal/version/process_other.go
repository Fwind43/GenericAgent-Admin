//go:build !windows

package version

import (
	"os/exec"
	"syscall"
)

func hideChildWindow(cmd *exec.Cmd) {}

func detachUpdateProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
