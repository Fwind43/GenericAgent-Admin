//go:build windows

package version

import (
	"os/exec"
	"syscall"
)

func hideChildWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func detachUpdateProcess(cmd *exec.Cmd) {}
