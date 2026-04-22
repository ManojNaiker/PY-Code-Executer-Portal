import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";

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
}

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

  // Supporting files inside bundle/files/<name>
  const filesDir = path.join(bundleDir, "files");
  if (opts.supportingFiles.length > 0) {
    await fsp.mkdir(filesDir, { recursive: true });
    for (const f of opts.supportingFiles) {
      const safeName = path.basename(f.name).replace(/[^A-Za-z0-9._\- ]/g, "_");
      await fsp.copyFile(f.absPath, path.join(filesDir, safeName));
    }
  }

  // Logo file inside bundle/ — preserve the original filename so scripts that
  // reference a specific logo file (e.g. `alfresco_logo.ico`) can find it.
  let logoFilename = "";
  if (opts.logo) {
    const safeLogo = path.basename(opts.logo.filename).replace(/[^A-Za-z0-9._\- ]/g, "_") || `logo${path.extname(opts.logo.filename) || ".png"}`;
    logoFilename = safeLogo;
    await fsp.copyFile(opts.logo.absPath, path.join(bundleDir, logoFilename));
  }

  // 3. Generate assets.go with build-time constants.
  const assetsGo = `package main

func init() {
\tscriptName = ${escGoString(safeIdent(opts.scriptName))}
\tscriptFilename = ${escGoString(safeFilename)}
\thasLogo = ${opts.logo ? "true" : "false"}
\tlogoFilename = ${escGoString(logoFilename)}
}
`;
  await fsp.writeFile(path.join(buildDir, "assets.go"), assetsGo, "utf8");

  // 4. If we have a logo that is a PNG, convert to ICO and create rsrc.syso so the EXE has an icon.
  if (opts.logo) {
    try {
      const logoBytes = await fsp.readFile(opts.logo.absPath);
      const isPng = logoBytes.length >= 8 && logoBytes.slice(1, 4).toString() === "PNG";
      if (isPng) {
        const icoBytes = pngToIco(logoBytes);
        const icoPath = path.join(buildDir, "icon.ico");
        await fsp.writeFile(icoPath, icoBytes);
        const sysoPath = path.join(buildDir, "rsrc.syso");
        const env = { ...process.env, GOPATH: GO_CACHE, GOCACHE: path.join(GO_CACHE, "build-cache") };
        const r = await runCmd(RSRC_BIN, ["-ico", "icon.ico", "-arch", "amd64", "-o", "rsrc.syso"], { cwd: buildDir, env, timeoutMs: 30_000 });
        if (r.code !== 0) {
          // Non-fatal — proceed without icon.
          await fsp.unlink(sysoPath).catch(() => {});
        }
      }
    } catch {
      // ignore icon errors
    }
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
  const result = await runCmd("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", "output.exe", "."], {
    cwd: buildDir,
    env,
    timeoutMs: 180_000,
  });
  if (result.code !== 0) {
    throw new Error(`Go build failed: ${result.stderr || result.stdout}`);
  }
  if (!fs.existsSync(exePath)) {
    throw new Error("Build succeeded but EXE not found");
  }

  return {
    exePath,
    cleanup: async () => {
      await fsp.rm(buildDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
