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
	scriptName       = "Script"
	scriptFilename   = "script.py"
	hasLogo          = false
	logoFilename     = ""
	hasBundledPython = false
	buildHash        = "dev"
)

// extractRoot returns the hidden cache directory where the bundle is unpacked.
// We use %LOCALAPPDATA% so the user never sees these files in Explorer when
// they double-click the EXE — same approach PyInstaller --onefile uses.
func extractRoot() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.Getenv("APPDATA")
	}
	if base == "" {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "PyExecPortal", scriptName+"-"+buildHash)
	return dir, nil
}

// extractAll walks the embedded bundle and writes every file to targetDir.
// A marker file (.ready) records the buildHash; if it already matches the
// current build we skip the entire extraction (very fast subsequent launches).
func extractAll(targetDir string) error {
	marker := filepath.Join(targetDir, ".ready")
	if data, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(data)) == buildHash {
		return nil
	}
	// Stale or missing marker — wipe the directory so partial extracts from
	// a previous version cannot pollute the new one.
	_ = os.RemoveAll(targetDir)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return err
	}
	err := fs.WalkDir(bundleFS, "bundle", func(p string, d fs.DirEntry, err error) error {
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
	if err != nil {
		return err
	}
	return os.WriteFile(marker, []byte(buildHash), 0o644)
}

// findPython prefers the bundled Python distribution. Falls back to system
// Python only if the bundled tree is missing (legacy builds without it).
func findPython(workDir string) (string, error) {
	if hasBundledPython {
		// pythonw.exe runs without flashing a console; python.exe is the fallback.
		// python-build-standalone does not always ship pythonw, so we try both.
		candidates := []string{
			filepath.Join(workDir, "python", "pythonw.exe"),
			filepath.Join(workDir, "python", "python.exe"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
	}
	for _, c := range []string{"pythonw", "pyw", "pythonw3", "python", "py", "python3"} {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("Python not found")
}

func showError(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	mb := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString(scriptName)
	body, _ := syscall.UTF16PtrFromString(msg)
	// MB_OK | MB_ICONERROR
	mb.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}

func run() int {
	exePath, err := os.Executable()
	if err != nil {
		showError("Cannot resolve EXE path: " + err.Error())
		return 1
	}
	exeDir := filepath.Dir(exePath)

	workDir, err := extractRoot()
	if err != nil {
		showError("Cannot resolve cache directory: " + err.Error())
		return 1
	}
	if err := extractAll(workDir); err != nil {
		showError("Extraction failed: " + err.Error())
		return 1
	}

	py, err := findPython(workDir)
	if err != nil {
		showError("Python is not installed and no bundled Python was included.\n\nPlease install Python 3 from https://www.python.org/downloads/")
		return 1
	}

	scriptPath := filepath.Join(workDir, scriptFilename)
	args := append([]string{scriptPath}, os.Args[1:]...)
	cmd := exec.Command(py, args...)
	// Run with cwd = the EXE's folder so any files the script creates
	// (logs, exports, undo_log.txt, etc.) land next to the EXE where the
	// user expects them — NOT in the hidden extract directory.
	cmd.Dir = exeDir

	// Forward stdio so console scripts still print, and so the EXE returns
	// the script's actual exit code.
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Hide any subprocess console window the child might try to spawn.
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
