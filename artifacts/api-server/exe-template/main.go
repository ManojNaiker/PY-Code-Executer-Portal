//go:build windows

package main

import (
        "bytes"
        "embed"
        "fmt"
        "io/fs"
        "os"
        "os/exec"
        "path/filepath"
        "strings"
        "syscall"
        "time"
        "unsafe"
)

// IMPORTANT: the `all:` prefix is REQUIRED. Without it, Go's embed silently
// excludes every file/dir whose name starts with `_` or `.` — which means
// every `__init__.py`, every `__pycache__`, every `_collections_abc.py`,
// `_bootlocale.py`, etc. gets dropped. The result is a Python distribution
// that's missing `Lib/encodings/__init__.py`, so pythonw.exe crashes at
// startup with: "Fatal Python error: init_fs_encoding: failed to get the
// Python codec of the filesystem encoding".
//
//go:embed all:bundle
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

// diagLog writes a diagnostic log file next to the EXE so the user has a
// way to see what happened when a GUI build silently fails. The log records
// the timestamps, paths, command line, exit code, and the tail of stderr.
type diagLog struct {
        path string
        buf  bytes.Buffer
}

func newDiagLog(exeDir string) *diagLog {
        return &diagLog{path: filepath.Join(exeDir, scriptName+".log")}
}

func (l *diagLog) printf(format string, a ...any) {
        fmt.Fprintf(&l.buf, format+"\n", a...)
}

func (l *diagLog) flush() {
        _ = os.WriteFile(l.path, l.buf.Bytes(), 0o644)
}

func run() int {
        startedAt := time.Now()

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

        log := newDiagLog(exeDir)
        defer log.flush()
        log.printf("=== %s @ %s ===", scriptName, startedAt.Format(time.RFC3339))
        log.printf("EXE:        %s", exePath)
        log.printf("EXE dir:    %s", exeDir)
        log.printf("Build hash: %s", buildHash)
        log.printf("GUI build:  %v", isGuiBuild)
        log.printf("OS args:    %v", os.Args)

        workDir, err := extractRoot()
        if err != nil {
                log.printf("ERROR resolving cache dir: %v", err)
                if isGuiBuild {
                        showError("Cannot resolve cache directory: " + err.Error() + "\n\nLog: " + log.path)
                } else {
                        fmt.Fprintln(os.Stderr, "Cannot resolve cache directory:", err)
                }
                return 1
        }
        log.printf("Work dir:   %s", workDir)

        extractStart := time.Now()
        if err := extractAll(workDir); err != nil {
                log.printf("ERROR extracting bundle: %v", err)
                if isGuiBuild {
                        showError("Extraction failed: " + err.Error() + "\n\nLog: " + log.path)
                } else {
                        fmt.Fprintln(os.Stderr, "Extraction failed:", err)
                }
                return 1
        }
        log.printf("Extracted in %s", time.Since(extractStart).Round(time.Millisecond))

        py, err := findPython(workDir)
        if err != nil {
                msg := "Python is not installed and no bundled Python was included.\n\nPlease install Python 3 from https://www.python.org/downloads/"
                log.printf("ERROR finding python: %v", err)
                if isGuiBuild {
                        showError(msg + "\n\nLog: " + log.path)
                } else {
                        fmt.Fprintln(os.Stderr, msg)
                }
                return 1
        }
        log.printf("Python:     %s", py)

        scriptPath := filepath.Join(workDir, scriptFilename)
        args := append([]string{scriptPath}, os.Args[1:]...)
        log.printf("Command:    %s %s", py, strings.Join(args, " "))

        cmd := exec.Command(py, args...)
        // Run with cwd = the EXE's folder so any files the script creates
        // (logs, exports, undo_log.txt, etc.) land next to the EXE where the
        // user expects them — NOT in the hidden extract directory.
        cmd.Dir = exeDir

        // Force UTF-8 for the child Python so emoji / non-ASCII print() output
        // doesn't crash on Windows code page 1252.
        cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8", "PYTHONUTF8=1", "PYTHONUNBUFFERED=1")

        // Capture stderr (and stdout for GUI) to a buffer so we can log it AND
        // show it in the error dialog. For CLI builds we ALSO inherit so the
        // user sees output live in the console.
        var stderrBuf bytes.Buffer

        if isGuiBuild {
                // In GUI mode the parent has NO console — passing os.Stdin/Stdout/
                // Stderr to the child gives invalid handles and on some Windows
                // configurations causes pythonw.exe to silently fail at startup.
                // Capture to a buffer instead so we can surface errors.
                cmd.Stdin = nil
                cmd.Stdout = &stderrBuf
                cmd.Stderr = &stderrBuf
                cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
        } else {
                // CLI mode: inherit so print() goes to the console live, but ALSO
                // tee stderr into our buffer so the run.log captures any traceback.
                cmd.Stdin = os.Stdin
                cmd.Stdout = os.Stdout
                cmd.Stderr = &teeWriter{primary: os.Stderr, secondary: &stderrBuf}
        }

        runStart := time.Now()
        exitCode := 0
        runErr := cmd.Run()
        runDur := time.Since(runStart).Round(time.Millisecond)
        log.printf("Ran in:     %s", runDur)

        if runErr != nil {
                if ee, ok := runErr.(*exec.ExitError); ok {
                        exitCode = ee.ExitCode()
                        log.printf("Exit code:  %d", exitCode)
                } else {
                        log.printf("ERROR running script: %v", runErr)
                        if isGuiBuild {
                                tail := tailString(stderrBuf.String(), 1500)
                                msg := "Failed to run script: " + runErr.Error()
                                if tail != "" {
                                        msg += "\n\n--- Python output ---\n" + tail
                                }
                                msg += "\n\nFull log: " + log.path
                                showError(msg)
                        } else {
                                fmt.Fprintln(os.Stderr, "Failed to run script:", runErr)
                        }
                        exitCode = 1
                }
        } else {
                log.printf("Exit code:  0")
        }

        // Always log captured python output (helpful even on success).
        if stderrBuf.Len() > 0 {
                log.printf("--- python stderr/stdout ---")
                log.printf("%s", stderrBuf.String())
        }

        // For GUI builds with a non-zero exit code, surface the script's traceback
        // in a MessageBox so the user knows WHY it crashed instead of seeing
        // "nothing happens".
        if isGuiBuild && exitCode != 0 && runErr != nil {
                // Already shown above for non-ExitError case; for ExitError we still
                // want to show the traceback since pythonw swallows the console.
                if _, ok := runErr.(*exec.ExitError); ok {
                        tail := tailString(stderrBuf.String(), 1500)
                        if tail != "" {
                                showError(fmt.Sprintf("Script exited with code %d.\n\n--- Output ---\n%s\n\nFull log: %s", exitCode, tail, log.path))
                        } else {
                                showError(fmt.Sprintf("Script exited with code %d (no output).\n\nFull log: %s", exitCode, log.path))
                        }
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

// tailString returns the last n characters of s.
func tailString(s string, n int) string {
        if len(s) <= n {
                return s
        }
        return "..." + s[len(s)-n:]
}

// teeWriter writes to two writers (used to tee CLI stderr to both console and log buffer).
type teeWriter struct {
        primary   *os.File
        secondary *bytes.Buffer
}

func (t *teeWriter) Write(p []byte) (int, error) {
        t.secondary.Write(p)
        return t.primary.Write(p)
}

func main() {
        os.Exit(run())
}
