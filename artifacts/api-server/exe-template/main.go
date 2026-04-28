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
	isGuiBuild       = false
)

// extractRoot returns the hidden cache directory where the bundle is unpacked.
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

// findPython locates the Python interpreter to run the script.
//   - GUI build  → prefer pythonw.exe (no console flash); fall back to python.exe
//   - CLI build  → use python.exe so its stdio inherits our parent console
func findPython(workDir string) (string, error) {
	if hasBundledPython {
		var candidates []string
		if isGuiBuild {
			candidates = []string{
				filepath.Join(workDir, "python", "pythonw.exe"),
				filepath.Join(workDir, "python", "python.exe"),
			}
		} else {
			candidates = []string{
				filepath.Join(workDir, "python", "python.exe"),
				filepath.Join(workDir, "python", "pythonw.exe"),
			}
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
	}
	preferred := []string{"python", "py", "python3"}
	if isGuiBuild {
		preferred = []string{"pythonw", "pyw", "python", "py", "python3"}
	}
	for _, c := range preferred {
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

// pause waits for any keypress on Windows console — used so the console
// window does not auto-close after a CLI script finishes, giving the user
// time to read the output.
func pause() {
	fmt.Print("\nPress Enter to close...")
	var b [1]byte
	_, _ = os.Stdin.Read(b[:])
}

func run() int {
	exePath, err := os.Executable()
	if err != nil {
		if isGuiBuild {
			showError("Cannot resolve EXE path: " + err.Error())
		} else {
			fmt.Fprintln(os.Stderr, "Cannot resolve EXE path:", err)
		}
		return 1
	}
	exeDir := filepath.Dir(exePath)

	workDir, err := extractRoot()
	if err != nil {
		if isGuiBuild {
			showError("Cannot resolve cache directory: " + err.Error())
		} else {
			fmt.Fprintln(os.Stderr, "Cannot resolve cache directory:", err)
		}
		return 1
	}
	if err := extractAll(workDir); err != nil {
		if isGuiBuild {
			showError("Extraction failed: " + err.Error())
		} else {
			fmt.Fprintln(os.Stderr, "Extraction failed:", err)
		}
		return 1
	}

	py, err := findPython(workDir)
	if err != nil {
		msg := "Python is not installed and no bundled Python was included.\n\nPlease install Python 3 from https://www.python.org/downloads/"
		if isGuiBuild {
			showError(msg)
		} else {
			fmt.Fprintln(os.Stderr, msg)
		}
		return 1
	}

	scriptPath := filepath.Join(workDir, scriptFilename)
	args := append([]string{scriptPath}, os.Args[1:]...)
	cmd := exec.Command(py, args...)
	// Run with cwd = the EXE's folder so any files the script creates
	// (logs, exports, undo_log.txt, etc.) land next to the EXE where the
	// user expects them — NOT in the hidden extract directory.
	cmd.Dir = exeDir

	// Inherit stdio so console scripts print straight to the user's console.
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// In GUI mode, suppress any subprocess console window the child might
	// try to spawn. In console mode, we WANT the child to inherit our
	// console for stdout/stderr to flow through, so do NOT set the flag.
	if isGuiBuild {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	}

	exitCode := 0
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		} else {
			if isGuiBuild {
				showError("Failed to run script: " + err.Error())
			} else {
				fmt.Fprintln(os.Stderr, "Failed to run script:", err)
			}
			exitCode = 1
		}
	}

	// In console mode, pause before closing so the user can read the output
	// when launched from Explorer (double-click). When launched from an
	// existing CMD prompt, the parent console persists anyway.
	if !isGuiBuild {
		pause()
	}
	return exitCode
}

func main() {
	os.Exit(run())
}
