//go:build windows

package api

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const directoryPickerScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$d = New-Object System.Windows.Forms.FolderBrowserDialog
try {
    $owner.Text = 'GenericAgent directory picker'
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.Opacity = 0
    $owner.TopMost = $true
    $owner.Show()
    $owner.Activate()
    $d.Description = 'Select GenericAgent directory'
    $d.ShowNewFolderButton = $true
    if ($env:GA_ADMIN_BROWSE_START -and (Test-Path -LiteralPath $env:GA_ADMIN_BROWSE_START)) {
        $d.SelectedPath = $env:GA_ADMIN_BROWSE_START
    }
    if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $d.SelectedPath
    }
} finally {
    $d.Dispose()
    $owner.Dispose()
}
`

func chooseDirectory(start string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", directoryPickerScript)
	hideChildWindow(cmd)
	cmd.Env = append(os.Environ(), "GA_ADMIN_BROWSE_START="+start)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("directory picker failed: %s", strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}
