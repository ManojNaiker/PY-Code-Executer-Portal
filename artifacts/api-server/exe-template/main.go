package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func banner() {
	bar := strings.Repeat("=", 60)
	fmt.Println(bar)
	fmt.Printf("  %s\n", scriptName)
	fmt.Println("  Powered by PyExec Portal")
	fmt.Println(bar)
}

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

func findPython() (string, error) {
	for _, c := range []string{"python", "py", "python3"} {
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("Python not found on PATH. Please install Python from https://www.python.org/downloads/ and re-run.")
}

func openImage(p string) {
	// Best-effort: open the logo with the default viewer (Windows: cmd /c start ...)
	cmd := exec.Command("cmd", "/c", "start", "", p)
	_ = cmd.Start()
}

func pause() {
	fmt.Print("\nPress Enter to exit...")
	bufR := make([]byte, 1)
	_, _ = io.ReadFull(os.Stdin, bufR)
}

func run() int {
	banner()

	// Extract bundle to a working dir next to the EXE so supporting files
	// can be edited/inspected by the user.
	exePath, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error: cannot resolve exe path:", err)
		return 1
	}
	workDir := filepath.Join(filepath.Dir(exePath), scriptName+"_files")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "error: cannot create work dir:", err)
		return 1
	}

	if err := extractAll(workDir); err != nil {
		fmt.Fprintln(os.Stderr, "error: extraction failed:", err)
		return 1
	}

	// If a logo is bundled, also drop it next to the EXE and open it.
	if hasLogo && logoFilename != "" {
		src := filepath.Join(workDir, logoFilename)
		dst := filepath.Join(filepath.Dir(exePath), logoFilename)
		if data, err := os.ReadFile(src); err == nil {
			_ = os.WriteFile(dst, data, 0o644)
			openImage(dst)
			fmt.Printf("Logo: %s\n\n", dst)
		}
	}

	py, err := findPython()
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		pause()
		return 1
	}

	scriptPath := filepath.Join(workDir, scriptFilename)
	args := append([]string{scriptPath}, os.Args[1:]...)
	cmd := exec.Command(py, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = workDir
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			pause()
			return ee.ExitCode()
		}
		fmt.Fprintln(os.Stderr, "error: failed to run script:", err)
		pause()
		return 1
	}
	pause()
	return 0
}

func main() {
	os.Exit(run())
}
