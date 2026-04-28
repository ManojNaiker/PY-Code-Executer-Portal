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

/**
 * Strip non-essential files from a copied Python distribution to dramatically
 * shrink the resulting EXE. Removes ~70-80 MB worth of debug symbols, build-
 * time tooling (pip/setuptools/venv), the IDLE IDE, the test suite, and the
 * Tcl/Tk runtime when the script does not import tkinter.
 *
 * Safe to call on the bundle dir (NOT the cache dir).
 */
export async function pruneWindowsPython(
  pyDir: string,
  opts: { keepTkinter?: boolean; keepSsl?: boolean; keepSqlite?: boolean } = {},
): Promise<{ removed: string[]; bytesFreed: number }> {
  const removed: string[] = [];
  let bytesFreed = 0;

  const sizeOf = async (p: string): Promise<number> => {
    try {
      const st = await fsp.stat(p);
      if (st.isFile()) return st.size;
      let total = 0;
      const entries = await fsp.readdir(p, { withFileTypes: true });
      for (const e of entries) total += await sizeOf(path.join(p, e.name));
      return total;
    } catch {
      return 0;
    }
  };

  const remove = async (rel: string) => {
    const target = path.join(pyDir, rel);
    if (!fs.existsSync(target)) return;
    const sz = await sizeOf(target);
    await fsp.rm(target, { recursive: true, force: true });
    removed.push(rel);
    bytesFreed += sz;
  };

  // Always-safe removals — debug symbols and build-time tooling never used
  // by an end-user running a packaged script.
  const alwaysRemove = [
    "Lib/ensurepip",
    "Lib/idlelib",
    "Lib/turtledemo",
    "Lib/test",
    "Lib/venv",
    "Lib/distutils",
    "Lib/lib2to3",
    "Lib/site-packages/pip",
    "Lib/site-packages/setuptools",
    "Lib/site-packages/pkg_resources",
    "Lib/site-packages/_distutils_hack",
    "Lib/site-packages/distutils-precedence.pth",
    "Lib/site-packages/README.txt",
    "include",
    "libs",
    "Scripts",
    "LICENSE.txt",
  ];
  for (const rel of alwaysRemove) await remove(rel);

  // Tkinter / Tcl runtime — huge (~14 MB) and rarely used.
  if (!opts.keepTkinter) {
    await remove("tcl");
    await remove("Lib/tkinter");
    await remove("DLLs/_tkinter.pyd");
    await remove("DLLs/tcl86t.dll");
    await remove("DLLs/tk86t.dll");
    await remove("DLLs/zlib1.dll"); // shipped for tkinter; safe to drop
  }

  // sqlite3 — drop if script doesn't use it.
  if (!opts.keepSqlite) {
    await remove("Lib/sqlite3");
    await remove("DLLs/_sqlite3.pyd");
    await remove("DLLs/sqlite3.dll");
  }

  // SSL / crypto — biggest single contributor (libcrypto-3-x64.* alone is ~19 MB).
  if (!opts.keepSsl) {
    await remove("Lib/ssl.py");
    await remove("DLLs/_ssl.pyd");
    await remove("DLLs/_hashlib.pyd");
    await remove("DLLs/libssl-3-x64.dll");
    await remove("DLLs/libcrypto-3-x64.dll");
  }

  // Walk and delete: all *.pdb (debug symbols), all __pycache__ dirs,
  // all *.dist-info directories under site-packages, and test modules.
  const walkPrune = async (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__pycache__" || e.name.endsWith(".dist-info") || e.name === "tests" || e.name === "test") {
          const sz = await sizeOf(full);
          await fsp.rm(full, { recursive: true, force: true });
          removed.push(path.relative(pyDir, full));
          bytesFreed += sz;
          continue;
        }
        await walkPrune(full);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        if (
          lower.endsWith(".pdb") ||
          lower.endsWith(".pyc") ||
          /^_test.*\.(pyd|dll)$/i.test(e.name) ||
          /^_ctypes_test.*\.(pyd|dll)$/i.test(e.name) ||
          /^xxlimited.*\.(pyd|dll)$/i.test(e.name)
        ) {
          try {
            const st = await fsp.stat(full);
            await fsp.rm(full, { force: true });
            bytesFreed += st.size;
            removed.push(path.relative(pyDir, full));
          } catch {}
        }
      }
    }
  };
  await walkPrune(pyDir);

  return { removed, bytesFreed };
}

/**
 * Best-effort detection of which heavy stdlib subsystems a script needs,
 * so the bundler knows whether it can prune tkinter / ssl / sqlite.
 */
export function detectStdlibNeeds(scriptCode: string): {
  needsTkinter: boolean;
  needsSsl: boolean;
  needsSqlite: boolean;
} {
  const code = scriptCode;
  const has = (re: RegExp) => re.test(code);
  return {
    needsTkinter: has(/\b(?:import|from)\s+(?:tkinter|turtle|idlelib)\b/),
    needsSsl: has(
      /\b(?:import|from)\s+(?:ssl|http\.client|urllib\.request|urllib3|requests|httpx|aiohttp|email|imaplib|poplib|smtplib|nntplib|ftplib|websockets?)\b/,
    ),
    needsSqlite: has(/\b(?:import|from)\s+(?:sqlite3)\b/),
  };
}
