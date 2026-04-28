import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { ensureWindowsPython, copyTree, installWindowsWheels, pruneWindowsPython, detectStdlibNeeds } from "./windowsPython";
import { extractTopLevelImports, importToPackage as importToPipPackage } from "./pythonDeps";

// process.cwd() at runtime is `artifacts/api-server`. Resolve template path
// relative to cwd, with fallbacks so it also works from the workspace root.
function resolveTemplateDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "exe-template"),
    path.resolve(process.cwd(), "artifacts/api-server/exe-template"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "go.mod"))) return c;
  }
  return candidates[0];
}
const TEMPLATE_DIR = resolveTemplateDir();
const BUILD_ROOT = path.resolve(process.cwd(), ".cache/exe-builds");
const GO_CACHE = path.resolve(os.homedir(), ".cache/go");
const RSRC_BIN = path.join(GO_CACHE, "bin", "rsrc");

function safeIdent(s: string): string {
  return (s || "Script").replace(/[^A-Za-z0-9_\-]/g, "_").slice(0, 80) || "Script";
}

function escGoString(s: string): string {
  return JSON.stringify(s);
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`Timeout running ${cmd}`));
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => { clearTimeout(timeout); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

// Build a minimal ICO file that wraps a single PNG payload. Supported on Vista+.
function pngToIco(pngBytes: Buffer): Buffer {
  // Read PNG width/height from IHDR (after 8-byte signature).
  let width = 0;
  let height = 0;
  if (pngBytes.length >= 24 && pngBytes.slice(1, 4).toString() === "PNG") {
    width = pngBytes.readUInt32BE(16);
    height = pngBytes.readUInt32BE(20);
  }
  const w = width >= 256 ? 0 : width;
  const h = height >= 256 ? 0 : height;
  const dirHeader = Buffer.alloc(6);
  dirHeader.writeUInt16LE(0, 0); // reserved
  dirHeader.writeUInt16LE(1, 2); // type=icon
  dirHeader.writeUInt16LE(1, 4); // count=1
  const entry = Buffer.alloc(16);
  entry.writeUInt8(w, 0);
  entry.writeUInt8(h, 1);
  entry.writeUInt8(0, 2); // colors
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBytes.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([dirHeader, entry, pngBytes]);
}

export interface BuildExeOptions {
  scriptId: number;
  scriptName: string;
  scriptFilename: string;
  scriptCode: string;
  supportingFiles: Array<{ name: string; absPath: string }>;
  logo?: { absPath: string; filename: string } | null;
}

export interface BuildExeResult {
  exePath: string;
  cleanup: () => Promise<void>;
  bundledPython: boolean;
  installedPackages: string[];
  failedPackages: { pkg: string; error: string }[];
  bundleNote: string;
}

// Modules that ship inside the standalone Windows Python distribution and
// should never be installed via pip.
const PY_STDLIB_AND_BUILTINS = new Set([
  "abc","aifc","antigravity","argparse","ast","asynchat","asyncio","asyncore",
  "atexit","audioop","base64","bdb","binascii","bisect","builtins","bz2",
  "calendar","cgi","cgitb","chunk","cmath","cmd","code","codecs","codeop",
  "collections","colorsys","compileall","concurrent","configparser","contextlib",
  "contextvars","copy","copyreg","cProfile","crypt","csv","ctypes","curses",
  "dataclasses","datetime","dbm","decimal","difflib","dis","distutils","doctest",
  "email","encodings","ensurepip","enum","errno","faulthandler","fcntl","filecmp",
  "fileinput","fnmatch","fractions","ftplib","functools","gc","genericpath",
  "getopt","getpass","gettext","glob","graphlib","grp","gzip","hashlib","heapq",
  "hmac","html","http","idlelib","imaplib","imghdr","imp","importlib","inspect",
  "io","ipaddress","itertools","json","keyword","lib2to3","linecache","locale",
  "logging","lzma","mailbox","mailcap","marshal","math","mimetypes","mmap",
  "modulefinder","msilib","msvcrt","multiprocessing","netrc","nis","nntplib",
  "ntpath","nturl2path","numbers","opcode","operator","optparse","os","ossaudiodev",
  "pathlib","pdb","pickle","pickletools","pipes","pkgutil","platform","plistlib",
  "poplib","posix","posixpath","pprint","profile","pstats","pty","pwd","py_compile",
  "pyclbr","pydoc","pydoc_data","pyexpat","queue","quopri","random","re","readline",
  "reprlib","resource","rlcompleter","runpy","sched","secrets","select","selectors",
  "shelve","shlex","shutil","signal","site","smtpd","smtplib","sndhdr","socket",
  "socketserver","spwd","sqlite3","sre_compile","sre_constants","sre_parse","ssl",
  "stat","statistics","string","stringprep","struct","subprocess","sunau","symtable",
  "sys","sysconfig","syslog","tabnanny","tarfile","telnetlib","tempfile","termios",
  "test","textwrap","this","threading","time","timeit","tkinter","token","tokenize",
  "tomllib","trace","traceback","tracemalloc","tty","turtle","turtledemo","types",
  "typing","unicodedata","unittest","urllib","uu","uuid","venv","warnings","wave",
  "weakref","webbrowser","winreg","winsound","wsgiref","xdrlib","xml","xmlrpc",
  "zipapp","zipfile","zipimport","zlib","zoneinfo","_thread","__future__","__main__",
  // Tkinter sub-imports
  "Tkinter","tkMessageBox","tkSimpleDialog","tkFileDialog","tkColorChooser","tkFont","tkconstants",
]);

export async function buildExe(opts: BuildExeOptions): Promise<BuildExeResult> {
  await fsp.mkdir(BUILD_ROOT, { recursive: true });
  const buildDir = await fsp.mkdtemp(path.join(BUILD_ROOT, `s${opts.scriptId}-`));

  // 1. Copy go.mod and main.go from template.
  await fsp.copyFile(path.join(TEMPLATE_DIR, "go.mod"), path.join(buildDir, "go.mod"));
  await fsp.copyFile(path.join(TEMPLATE_DIR, "main.go"), path.join(buildDir, "main.go"));

  // 2. Build the bundle directory that gets embedded.
  const bundleDir = path.join(buildDir, "bundle");
  await fsp.mkdir(bundleDir, { recursive: true });

  // Main script file (sanitize filename to a safe name).
  const safeFilename = (opts.scriptFilename || "script.py").replace(/[^A-Za-z0-9._\- ]/g, "_") || "script.py";
  await fsp.writeFile(path.join(bundleDir, safeFilename), opts.scriptCode, "utf8");

  // Supporting files placed flat in bundle/ so scripts that open files by
  // a bare relative path (e.g. open("data.csv")) find them next to the script.
  const supportingByName = new Map<string, string>();
  for (const f of opts.supportingFiles) {
    const safeName = path.basename(f.name).replace(/[^A-Za-z0-9._\- ]/g, "_");
    await fsp.copyFile(f.absPath, path.join(bundleDir, safeName));
    supportingByName.set(safeName.toLowerCase(), safeName);
  }

  // Logo file inside bundle/ — preserve the original filename so scripts that
  // reference a specific logo file (e.g. `alfresco_logo.ico`) can find it.
  let logoFilename = "";
  let logoBytes: Buffer | null = null;
  let logoIsPng = false;
  if (opts.logo) {
    const safeLogo = path.basename(opts.logo.filename).replace(/[^A-Za-z0-9._\- ]/g, "_") || `logo${path.extname(opts.logo.filename) || ".png"}`;
    logoFilename = safeLogo;
    logoBytes = await fsp.readFile(opts.logo.absPath);
    logoIsPng = logoBytes.length >= 8 && logoBytes.slice(1, 4).toString() === "PNG";
    await fsp.writeFile(path.join(bundleDir, logoFilename), logoBytes);

    // Companion .ico for scripts that hard-code an .ico filename when admin uploaded a PNG.
    const ext = path.extname(logoFilename).toLowerCase();
    if (logoIsPng && ext !== ".ico") {
      const icoCompanion = logoFilename.slice(0, logoFilename.length - ext.length) + ".ico";
      await fsp.writeFile(path.join(bundleDir, icoCompanion), pngToIco(logoBytes));
    }
  }

  // 2b. Scan the script for hard-coded relative filenames and ensure each one
  // exists in the bundle. Logo-like extensions are filled with the uploaded
  // logo (converted to ICO when needed). Other files get a sample placeholder
  // so the script does not crash on FileNotFoundError; the user can replace
  // them with their real data afterwards.
  const referenced = detectReferencedFilenames(opts.scriptCode);
  const LOGO_EXTS = new Set([".ico", ".png", ".jpg", ".jpeg", ".bmp", ".gif"]);
  for (const fname of referenced) {
    const target = path.join(bundleDir, fname);
    if (fs.existsSync(target)) continue; // already provided (script, logo, supporting file)
    const ext = path.extname(fname).toLowerCase();
    if (LOGO_EXTS.has(ext) && logoBytes) {
      if (ext === ".ico") {
        await fsp.writeFile(target, logoIsPng ? pngToIco(logoBytes) : logoBytes);
      } else {
        await fsp.writeFile(target, logoBytes);
      }
    } else {
      const sample = sampleForExtension(ext, fname, opts.scriptName);
      if (sample !== null) await fsp.writeFile(target, sample);
    }
  }

  // 2c. Bundle a complete standalone Windows Python distribution + any third-party
  // packages the script imports. The result is a fully self-contained EXE that
  // runs on Windows without Python installed.
  let bundledPython = false;
  let installedPackages: string[] = [];
  let failedPackages: { pkg: string; error: string }[] = [];
  let bundleNote = "";
  let needsSsl = false;
  let needsSqlite = false;
  let needsTkinter = false;
  let isGuiScript = false;
  try {
    const pyDir = await ensureWindowsPython();
    const targetPyDir = path.join(bundleDir, "python");
    await copyTree(pyDir, targetPyDir);
    bundledPython = true;

    // Detect third-party imports the script needs and try to install matching
    // Windows wheels into the bundled site-packages.
    const imports = extractTopLevelImports(opts.scriptCode);
    const thirdParty = imports.filter((m) => !PY_STDLIB_AND_BUILTINS.has(m) && !m.startsWith("_"));
    if (thirdParty.length > 0) {
      const pkgs = Array.from(new Set(thirdParty.map(importToPipPackage)));
      const sitePackages = path.join(targetPyDir, "Lib", "site-packages");
      const r = await installWindowsWheels(pkgs, sitePackages);
      installedPackages = r.installed;
      failedPackages = r.failed;
      if (r.failed.length > 0) {
        bundleNote = `Some packages have no Windows wheel and could not be bundled: ${r.failed.map((f) => f.pkg).join(", ")}.`;
      }
    }

    // Prune the bundled Python distribution down to a minimal runtime to
    // shrink the resulting EXE. Detection considers both the script source
    // AND any pip-installed packages — e.g. requests pulls in ssl, openpyxl
    // pulls in nothing extra, sqlalchemy pulls in sqlite3.
    const stdlibNeeds = detectStdlibNeeds(opts.scriptCode);
    const pkgNames = installedPackages.map((p) => p.toLowerCase());
    const sslHeavyPkgs = ["requests", "httpx", "aiohttp", "urllib3", "boto3", "botocore", "google-api-python-client", "openai", "anthropic"];
    const sqlitePkgs = ["sqlalchemy", "alembic", "django", "peewee"];
    const tkinterPkgs = ["matplotlib", "pillow"]; // matplotlib has TkAgg backend; pillow has ImageTk
    const guiPkgs = ["pyqt5", "pyqt6", "pyside2", "pyside6", "wxpython", "kivy", "pygame", "customtkinter", "ttkbootstrap", "ttkthemes"];
    needsSsl = stdlibNeeds.needsSsl || pkgNames.some((p) => sslHeavyPkgs.includes(p));
    needsSqlite = stdlibNeeds.needsSqlite || pkgNames.some((p) => sqlitePkgs.includes(p));
    needsTkinter = stdlibNeeds.needsTkinter || pkgNames.some((p) => tkinterPkgs.includes(p));
    isGuiScript = needsTkinter || pkgNames.some((p) => guiPkgs.includes(p)) || /\b(?:import|from)\s+(?:PyQt5|PyQt6|PySide2|PySide6|wx|kivy|pygame|customtkinter|ttkbootstrap)\b/.test(opts.scriptCode);
    const pruned = await pruneWindowsPython(targetPyDir, {
      keepSsl: needsSsl,
      keepSqlite: needsSqlite,
      keepTkinter: needsTkinter,
    });
    const mb = (pruned.bytesFreed / (1024 * 1024)).toFixed(1);
    bundleNote = bundleNote
      ? `${bundleNote} (Trimmed ${mb} MB of unused runtime)`
      : `Trimmed ${mb} MB of unused runtime files.`;
  } catch (err) {
    bundleNote = `Failed to bundle Windows Python: ${(err as Error).message}. The EXE will fall back to system Python on the user's machine.`;
  }

  // 3. Generate assets.go with build-time constants.
  // buildHash uniquely identifies this EXE's bundle contents so the runtime
  // extractor only re-extracts when the bundle actually changed (when the
  // admin uploads a new script or the Python version is bumped).
  const crypto = await import("node:crypto");
  const buildHash = crypto
    .createHash("sha256")
    .update(opts.scriptCode)
    .update("\0")
    .update(safeFilename)
    .update("\0")
    .update(installedPackages.join(","))
    .update("\0")
    .update(bundledPython ? "py3.11.9" : "system")
    .digest("hex")
    .slice(0, 16);
  const assetsGo = `package main

func init() {
\tscriptName = ${escGoString(safeIdent(opts.scriptName))}
\tscriptFilename = ${escGoString(safeFilename)}
\thasLogo = ${opts.logo ? "true" : "false"}
\tlogoFilename = ${escGoString(logoFilename)}
\thasBundledPython = ${bundledPython ? "true" : "false"}
\tbuildHash = ${escGoString(buildHash)}
\tisGuiBuild = ${isGuiScript ? "true" : "false"}
}
`;
  await fsp.writeFile(path.join(buildDir, "assets.go"), assetsGo, "utf8");

  // 4. Embed Windows icon + application manifest into the EXE via rsrc.
  // The icon makes the EXE look like a real branded app (Adobe / LibreOffice
  // style) in Explorer / taskbar / Start menu. The manifest declares the app
  // identity, requested execution level (asInvoker, no UAC prompt), and
  // common controls dependency, which all help reduce SmartScreen noise.
  try {
    let icoCreated = false;
    if (opts.logo) {
      const lb = await fsp.readFile(opts.logo.absPath);
      const ext = path.extname(opts.logo.filename).toLowerCase();
      const isPng = lb.length >= 8 && lb.slice(1, 4).toString() === "PNG";
      const isIco = ext === ".ico" || (lb.length >= 4 && lb.readUInt16LE(0) === 0 && lb.readUInt16LE(2) === 1);
      if (isIco) {
        await fsp.writeFile(path.join(buildDir, "icon.ico"), lb);
        icoCreated = true;
      } else if (isPng) {
        await fsp.writeFile(path.join(buildDir, "icon.ico"), pngToIco(lb));
        icoCreated = true;
      }
    }

    const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const appId = safeIdent(opts.scriptName).replace(/\s+/g, "") || "PyExecApp";
    const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="PyExec.${xmlEsc(appId)}" type="win32"/>
  <description>${xmlEsc(opts.scriptName)}</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}"/>
    </application>
  </compatibility>
</assembly>
`;
    await fsp.writeFile(path.join(buildDir, "app.manifest"), manifest, "utf8");

    const args = ["-arch", "amd64", "-manifest", "app.manifest"];
    if (icoCreated) args.push("-ico", "icon.ico");
    args.push("-o", "rsrc.syso");
    const renv = { ...process.env, GOPATH: GO_CACHE, GOCACHE: path.join(GO_CACHE, "build-cache") };
    const r = await runCmd(RSRC_BIN, args, { cwd: buildDir, env: renv, timeoutMs: 30_000 });
    if (r.code !== 0) {
      await fsp.unlink(path.join(buildDir, "rsrc.syso")).catch(() => {});
    }
  } catch {
    // Non-fatal — proceed without icon/manifest.
  }

  // 5. Cross-compile to Windows EXE.
  const exePath = path.join(buildDir, "output.exe");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GOOS: "windows",
    GOARCH: "amd64",
    CGO_ENABLED: "0",
    GOPATH: GO_CACHE,
    GOCACHE: path.join(GO_CACHE, "build-cache"),
    GOMODCACHE: path.join(GO_CACHE, "mod"),
  };
  // Console subsystem (default) for CLI scripts so users see print() output in
  // a terminal window. Windows GUI subsystem only for tkinter/PyQt/etc. scripts.
  const ldflags = isGuiScript ? "-s -w -H windowsgui" : "-s -w";
  const result = await runCmd("go", ["build", "-trimpath", `-ldflags=${ldflags}`, "-o", "output.exe", "."], {
    cwd: buildDir,
    env,
    timeoutMs: 600_000,
  });
  if (result.code !== 0) {
    throw new Error(`Go build failed: ${result.stderr || result.stdout}`);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error("Build succeeded but EXE not found");
  }

  return {
    exePath,
    bundledPython,
    installedPackages,
    failedPackages,
    bundleNote,
    cleanup: async () => {
      await fsp.rm(buildDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Filename detection: pull bare relative filenames out of the script source.
// ---------------------------------------------------------------------------

const ALLOWED_EXTS = new Set([
  ".ico", ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".svg",
  ".csv", ".tsv", ".txt", ".log", ".md",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".xlsx", ".xls", ".xlsm", ".xlsb",
  ".docx", ".doc", ".pdf", ".rtf",
  ".pptx", ".ppt",
  ".db", ".sqlite", ".sqlite3",
  ".html", ".htm", ".xml",
  ".pem", ".crt", ".key",
  ".bat", ".sh", ".ps1",
  ".zip",
]);

const SKIP_NAMES = new Set([
  "requirements.txt", "readme.md", "license", "license.txt",
  "setup.py", "setup.cfg", "pyproject.toml", "manifest.in",
  ".gitignore", "package.json", "tsconfig.json",
]);

export function detectReferencedFilenames(code: string): string[] {
  const out = new Set<string>();
  const re = /['"]([A-Za-z0-9_\-. ]{1,200})['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const raw = m[1].trim();
    if (!raw || raw.length > 120) continue;
    if (raw.includes("/") || raw.includes("\\")) continue;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0 || dot === raw.length - 1) continue;
    const ext = raw.slice(dot).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) continue;
    if (SKIP_NAMES.has(raw.toLowerCase())) continue;
    // Skip pure version strings, urls, and mime-style "image/png" already filtered by separator check.
    if (/^\d+(\.\d+)+$/.test(raw)) continue;
    out.add(raw);
  }
  return Array.from(out);
}

export function sampleForExtension(ext: string, filename: string, scriptName: string): Buffer | null {
  const header = `# Sample placeholder generated for ${scriptName}.\n# Replace this file with your real ${filename} before running.\n`;
  switch (ext) {
    case ".csv":
    case ".tsv": {
      const sep = ext === ".tsv" ? "\t" : ",";
      return Buffer.from(`column1${sep}column2${sep}column3\nvalue1${sep}value2${sep}value3\n`, "utf8");
    }
    case ".json":
      return Buffer.from(`{\n  "_comment": "Sample placeholder for ${filename}. Replace with real data.",\n  "example": true\n}\n`, "utf8");
    case ".yaml":
    case ".yml":
      return Buffer.from(`# Sample placeholder for ${filename}\nexample: true\n`, "utf8");
    case ".toml":
      return Buffer.from(`# Sample placeholder for ${filename}\n[example]\nkey = "value"\n`, "utf8");
    case ".ini":
    case ".cfg":
    case ".conf":
      return Buffer.from(`; Sample placeholder for ${filename}\n[default]\nkey = value\n`, "utf8");
    case ".env":
      return Buffer.from(`# Sample placeholder for ${filename}\nKEY=value\n`, "utf8");
    case ".txt":
    case ".log":
    case ".md":
      return Buffer.from(`${header}`, "utf8");
    case ".html":
    case ".htm":
      return Buffer.from(`<!-- Sample placeholder for ${filename} -->\n<html><body><p>Replace this file with your real content.</p></body></html>\n`, "utf8");
    case ".xml":
      return Buffer.from(`<!-- Sample placeholder for ${filename} -->\n<root></root>\n`, "utf8");
    case ".bat":
      return Buffer.from(`@echo off\nrem Sample placeholder for ${filename}\n`, "utf8");
    case ".sh":
      return Buffer.from(`#!/usr/bin/env bash\n# Sample placeholder for ${filename}\n`, "utf8");
    case ".ps1":
      return Buffer.from(`# Sample placeholder for ${filename}\n`, "utf8");
    // Binary formats we cannot meaningfully synthesize -> create a 0-byte
    // placeholder so the file exists; user will replace it.
    case ".xlsx":
    case ".xls":
    case ".xlsm":
    case ".xlsb":
    case ".docx":
    case ".doc":
    case ".pdf":
    case ".rtf":
    case ".pptx":
    case ".ppt":
    case ".db":
    case ".sqlite":
    case ".sqlite3":
    case ".zip":
    case ".pem":
    case ".crt":
    case ".key":
    case ".svg":
      return Buffer.from("", "utf8");
    default:
      return Buffer.from(header, "utf8");
  }
}
