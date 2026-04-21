import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const DEPS_DIR = path.join(os.homedir(), ".pyexec-deps");
const PACKAGE_NAME_MAP: Record<string, string> = {
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  PIL: "Pillow",
  yaml: "PyYAML",
  bs4: "beautifulsoup4",
  Crypto: "pycryptodome",
  serial: "pyserial",
  dotenv: "python-dotenv",
  dateutil: "python-dateutil",
  jwt: "PyJWT",
  magic: "python-magic",
  OpenSSL: "pyOpenSSL",
  google: "google-cloud",
  win32com: "pywin32",
  skimage: "scikit-image",
  matplotlib: "matplotlib",
  pandas: "pandas",
  numpy: "numpy",
  requests: "requests",
  openpyxl: "openpyxl",
  xlrd: "xlrd",
  xlsxwriter: "XlsxWriter",
  pdfplumber: "pdfplumber",
  PyPDF2: "PyPDF2",
  pypdf: "pypdf",
  docx: "python-docx",
  pptx: "python-pptx",
};

let stdlibCache: Set<string> | null = null;
let installedCache: Set<string> | null = null;
const installLocks = new Map<string, Promise<void>>();

async function getStdlibModules(): Promise<Set<string>> {
  if (stdlibCache) return stdlibCache;
  return new Promise((resolve) => {
    const proc = spawn("python3", [
      "-c",
      "import sys; print('\\n'.join(sorted(sys.stdlib_module_names)))",
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => {
      const set = new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
      // Always-builtin extras just in case
      ["__future__", "builtins", "sys", "os"].forEach((m) => set.add(m));
      stdlibCache = set;
      resolve(set);
    });
    proc.on("error", () => {
      stdlibCache = new Set();
      resolve(stdlibCache);
    });
  });
}

export function extractTopLevelImports(code: string): string[] {
  const found = new Set<string>();
  const lines = code.split(/\r?\n/);
  let inTriple: string | null = null;
  for (const rawLine of lines) {
    let line = rawLine;
    // Track triple-quoted strings (very rough but good enough)
    if (inTriple) {
      const idx = line.indexOf(inTriple);
      if (idx === -1) continue;
      line = line.slice(idx + 3);
      inTriple = null;
    }
    const tripleStart = line.match(/("""|''')/);
    if (tripleStart) {
      const startIdx = line.indexOf(tripleStart[1]);
      const rest = line.slice(startIdx + 3);
      const closeIdx = rest.indexOf(tripleStart[1]);
      if (closeIdx === -1) {
        inTriple = tripleStart[1];
        line = line.slice(0, startIdx);
      } else {
        line = line.slice(0, startIdx) + rest.slice(closeIdx + 3);
      }
    }
    const trimmed = line.replace(/#.*$/, "").trim();
    if (!trimmed) continue;

    let m = trimmed.match(/^import\s+([a-zA-Z0-9_.,\s]+)(?:\s+as\s+\w+)?$/);
    if (m) {
      for (const part of m[1].split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0].split(".")[0].trim();
        if (mod) found.add(mod);
      }
      continue;
    }
    m = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+/);
    if (m) {
      const mod = m[1].split(".")[0];
      // Relative imports start with '.' -> first split is empty, skip
      if (mod) found.add(mod);
    }
  }
  return [...found];
}

function importToPackage(mod: string): string {
  return PACKAGE_NAME_MAP[mod] ?? mod;
}

async function ensureDepsDir() {
  await fs.mkdir(DEPS_DIR, { recursive: true });
}

async function loadInstalledCache(): Promise<Set<string>> {
  if (installedCache) return installedCache;
  await ensureDepsDir();
  try {
    const entries = await fs.readdir(DEPS_DIR);
    installedCache = new Set(entries.map((e) => e.toLowerCase()));
  } catch {
    installedCache = new Set();
  }
  return installedCache;
}

async function isInstalled(mod: string): Promise<boolean> {
  const cache = await loadInstalledCache();
  // Check both module name and possible package dir variants
  if (cache.has(mod.toLowerCase())) return true;
  const pkg = importToPackage(mod).toLowerCase().replace(/-/g, "_");
  if (cache.has(pkg)) return true;
  // dist-info folder check
  for (const entry of cache) {
    if (entry.startsWith(`${pkg}-`) && entry.endsWith(".dist-info")) return true;
    if (entry.startsWith(`${mod.toLowerCase()}-`) && entry.endsWith(".dist-info")) return true;
  }
  return false;
}

function pipInstall(pkg: string, log?: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    log?.(`[deps] Installing ${pkg}...`);
    const proc = spawn("python3", [
      "-m", "pip", "install",
      "--target", DEPS_DIR,
      "--no-input",
      "--disable-pip-version-check",
      "--quiet",
      pkg,
    ], {
      timeout: 180000,
      env: {
        ...process.env,
        PIP_USER: "0",
        PIP_REQUIRE_VIRTUALENV: "0",
      },
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code: number | null) => {
      if (code === 0) {
        installedCache = null; // invalidate cache
        log?.(`[deps] Installed ${pkg}`);
        resolve();
      } else {
        log?.(`[deps] Failed to install ${pkg}: ${stderr.slice(0, 500)}`);
        reject(new Error(`pip install ${pkg} failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });
    proc.on("error", (err: Error) => reject(err));
  });
}

export type DepInstallResult = {
  attempted: string[];
  installed: string[];
  failed: { pkg: string; error: string }[];
  log: string;
};

export async function ensureDependencies(code: string): Promise<DepInstallResult> {
  await ensureDepsDir();
  const stdlib = await getStdlibModules();
  const imports = extractTopLevelImports(code);
  const result: DepInstallResult = { attempted: [], installed: [], failed: [], log: "" };
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  for (const mod of imports) {
    if (stdlib.has(mod)) continue;
    if (await isInstalled(mod)) continue;
    const pkg = importToPackage(mod);
    result.attempted.push(pkg);
    if (installLocks.has(pkg)) {
      try { await installLocks.get(pkg); result.installed.push(pkg); }
      catch (e: any) { result.failed.push({ pkg, error: e?.message ?? String(e) }); }
      continue;
    }
    const p = pipInstall(pkg, log);
    installLocks.set(pkg, p);
    try {
      await p;
      result.installed.push(pkg);
    } catch (e: any) {
      result.failed.push({ pkg, error: e?.message ?? String(e) });
    } finally {
      installLocks.delete(pkg);
    }
  }
  result.log = logs.join("\n");
  return result;
}

export function getDepsDir(): string {
  return DEPS_DIR;
}
