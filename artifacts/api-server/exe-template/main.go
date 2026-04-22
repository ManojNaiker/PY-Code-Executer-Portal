//go:build windows

package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed bundle
var bundleFS embed.FS

// These vars are filled in by a generated assets.go file at build time.
var (
	scriptName     = "Script"
	scriptFilename = "script.py"
	hasLogo        = false
	logoFilename   = ""
)

func extractAll(targetDir string) error {
	return fs.WalkDir(bundleFS, "bundle", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(p, "bundle")
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			return nil
		}
		out := filepath.Join(targetDir, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		data, err := bundleFS.ReadFile(p)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return err
		}
		return os.WriteFile(out, data, 0o644)
	})
}

// findPython prefers pythonw.exe so no console window flashes for GUI scripts.
func findPython() (string, error) {
	for _, c := range []string{"pythonw", "pyw", "pythonw3", "python", "py", "python3"} {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("Python not found on PATH")
}

func showError(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	mb := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString(scriptName)
	body, _ := syscall.UTF16PtrFromString(msg)
	mb.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}

func run() int {
	exePath, err := os.Executable()
	if err != nil {
		showError("Cannot resolve EXE path: " + err.Error())
		return 1
	}
	workDir := filepath.Join(filepath.Dir(exePath), scriptName+"_files")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		showError("Cannot create work directory: " + err.Error())
		return 1
	}

	if err := extractAll(workDir); err != nil {
		showError("Extraction failed: " + err.Error())
		return 1
	}

	py, err := findPython()
	if err != nil {
		showError("Python is not installed.\n\nPlease install Python 3 from https://www.python.org/downloads/\nMake sure to tick \"Add Python to PATH\" during installation.")
		return 1
	}

	scriptPath := filepath.Join(workDir, scriptFilename)
	args := append([]string{scriptPath}, os.Args[1:]...)
	cmd := exec.Command(py, args...)
	cmd.Dir = workDir
	// Hide any subprocess console window.
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return ee.ExitCode()
		}
		showError("Failed to run script: " + err.Error())
		return 1
	}
	return 0
}

func main() {
	os.Exit(run())
}
