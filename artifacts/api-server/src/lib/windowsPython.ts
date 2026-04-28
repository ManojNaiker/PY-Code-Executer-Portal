import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

export const WIN_PY_VERSION = "3.11.9";
const PBS_TAG = "20240814";
const PBS_FILENAME = `cpython-${WIN_PY_VERSION}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`;
const PBS_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PBS_FILENAME}`;

const CACHE_ROOT = path.resolve(os.homedir(), ".cache/pyexec-win-py");
const VERSION_DIR = path.join(CACHE_ROOT, `${WIN_PY_VERSION}_${PBS_TAG}`);
const PYTHON_DIR = path.join(VERSION_DIR, "python");
const TARBALL_PATH = path.join(CACHE_ROOT, PBS_FILENAME);

let preparePromise: Promise<string> | null = null;

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`Timeout running ${cmd}`));
    }, opts.timeoutMs ?? 600_000);
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => { clearTimeout(timeout); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 0, stderr });
    });
  });
}

async function download(url: string, dest: string): Promise<void> {
  const tmp = `${dest}.part`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmp));
  await fsp.rename(tmp, dest);
}

/**
 * Download and extract the standalone Windows Python distribution.
 * Returns the absolute path to the extracted `python/` directory which
 * contains `python.exe`, `pythonw.exe`, the full stdlib, tkinter, ssl, etc.
 *
 * The distribution is cached, so subsequent calls return immediately.
 */
export async function ensureWindowsPython(): Promise<string> {
  if (preparePromise) return preparePromise;
  preparePromise = (async () => {
    if (fs.existsSync(path.join(PYTHON_DIR, "python.exe"))) {
      return PYTHON_DIR;
    }
    await fsp.mkdir(VERSION_DIR, { recursive: true });

    if (!fs.existsSync(TARBALL_PATH)) {
      await download(PBS_URL, TARBALL_PATH);
    }

    const r = await runCmd("tar", ["-xzf", TARBALL_PATH, "-C", VERSION_DIR], { timeoutMs: 300_000 });
    if (r.code !== 0) {
      throw new Error(`Failed to extract Windows Python: ${r.stderr}`);
    }
    if (!fs.existsSync(path.join(PYTHON_DIR, "python.exe"))) {
      throw new Error(`Extraction succeeded but python.exe not found in ${PYTHON_DIR}`);
    }
    return PYTHON_DIR;
  })();
  try {
    return await preparePromise;
  } catch (e) {
    preparePromise = null;
    throw e;
  }
}

/**
 * Recursively copy `src` into `dest`. Both must exist or `dest` will be created.
 * Uses fs.cp under the hood (Node 16.7+).
 */
export async function copyTree(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  await fsp.cp(src, dest, { recursive: true, force: true, dereference: true });
}

export interface InstallWinDepsResult {
  attempted: string[];
  installed: string[];
  failed: { pkg: string; error: string }[];
  log: string;
}

/**
 * Install a list of pip packages into `targetDir` as Windows-x86_64 wheels
 * for CPython 3.11. Uses cross-platform pip on the build host (Linux), so
 * any package without a published Windows wheel will be reported as failed.
 */
export async function installWindowsWheels(
  packages: string[],
  targetDir: string,
): Promise<InstallWinDepsResult> {
  const result: InstallWinDepsResult = { attempted: [...packages], installed: [], failed: [], log: "" };
  if (packages.length === 0) return result;

  await fsp.mkdir(targetDir, { recursive: true });

  // Resolve pip args common across attempts.
  const baseArgs = [
    "-m", "pip", "install",
    "--target", targetDir,
    "--no-input",
    "--disable-pip-version-check",
    "--no-compile",
    "--platform", "win_amd64",
    "--python-version", "3.11",
    "--implementation", "cp",
    "--abi", "cp311",
    "--only-binary", ":all:",
    "--upgrade",
  ];

  const logs: string[] = [];

  // First try a single bulk install — much faster when it succeeds.
  const bulk = await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    const child = spawn("python3", [...baseArgs, ...packages], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PIP_USER: "0", PIP_REQUIRE_VIRTUALENV: "0" },
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("Timeout running pip install"));
    }, 600_000);
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => { clearTimeout(timeout); reject(err); });
    child.on("close", (code) => { clearTimeout(timeout); resolve({ code: code ?? 0, stderr }); });
  }).catch((err) => ({ code: -1, stderr: String(err) }));

  if (bulk.code === 0) {
    result.installed = [...packages];
    result.log = `[wheels] bulk install ok for: ${packages.join(", ")}`;
    return result;
  }
  logs.push(`[wheels] bulk install failed (exit ${bulk.code}); falling back to per-package install.`);
  logs.push(bulk.stderr.split("\n").slice(-20).join("\n"));

  // Fall back: install one package at a time so failures of one don't block others.
  result.installed = [];
  for (const pkg of packages) {
    const r = await new Promise<{ code: number; stderr: string }>((resolve) => {
      const child = spawn("python3", [...baseArgs, pkg], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PIP_USER: "0", PIP_REQUIRE_VIRTUALENV: "0" },
      });
      let stderr = "";
      const timeout = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ; resolve({ code: -1, stderr: "timeout" }); }, 300_000);
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", () => { clearTimeout(timeout); resolve({ code: -1, stderr }); });
      child.on("close", (code) => { clearTimeout(timeout); resolve({ code: code ?? 0, stderr }); });
    });
    if (r.code === 0) {
      result.installed.push(pkg);
      logs.push(`[wheels] installed ${pkg}`);
    } else {
      const tail = r.stderr.split("\n").slice(-6).join(" ").slice(0, 400);
      result.failed.push({ pkg, error: tail });
      logs.push(`[wheels] FAILED ${pkg}: ${tail}`);
    }
  }
  result.log = logs.join("\n");
  return result;
}

export function getWindowsPythonVersion(): string {
  return WIN_PY_VERSION;
}
