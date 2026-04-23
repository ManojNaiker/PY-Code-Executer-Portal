import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable, executionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import multer from "multer";
import { parseScriptInputs, type HardcodedPath } from "../lib/scriptParser";
import { ensureDependencies, getDepsDir, checkDependencies, installDependencies, type DepInstallResult } from "../lib/pythonDeps";
import tkShimSource from "../lib/tkShim.py";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
}).any();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyPathOverrides(
  code: string,
  overrides: { literal: string; replacementPath: string }[],
): { code: string; replaced: { literal: string; replacementPath: string }[] } {
  let out = code;
  const replaced: { literal: string; replacementPath: string }[] = [];
  for (const o of overrides) {
    const newLiteral = JSON.stringify(o.replacementPath); // safe Python string literal
    const re = new RegExp(escapeRegExp(o.literal), "g");
    if (re.test(out)) {
      out = out.replace(new RegExp(escapeRegExp(o.literal), "g"), newLiteral);
      replaced.push(o);
    }
  }
  return { code: out, replaced };
}

async function runPython(
  code: string,
  args: string[] = [],
  stdin?: string | null,
  fileBuffer?: Buffer | null,
  fileName?: string | null,
  tkInputs?: { fields?: Record<string, string>; action?: string } | null,
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  deps: DepInstallResult;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyexec-"));

  // If GUI inputs were provided, prepend the headless tkinter shim so widget
  // calls map onto our stubs and mainloop() invokes the user-selected button.
  const useShim = !!tkInputs;
  const finalCode = useShim ? `${tkShimSource}\n# === USER SCRIPT ===\n${code}` : code;
  const scriptPath = path.join(tmpDir, "script.py");
  await fs.writeFile(scriptPath, finalCode, "utf-8");

  let finalArgs = [...args];
  let uploadedFilePath: string | null = null;
  if (fileBuffer && fileName) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    uploadedFilePath = path.join(tmpDir, safeName);
    await fs.writeFile(uploadedFilePath, fileBuffer);
    if (!useShim) {
      // For non-GUI scripts, file path is appended to argv as before.
      finalArgs.push(uploadedFilePath);
    }
  }

  const deps = await ensureDependencies(code);

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: os.tmpdir(),
    TMPDIR: os.tmpdir(),
    PYTHONPATH: getDepsDir(),
  };
  if (useShim) {
    env.PYEXEC_TK_INPUTS = JSON.stringify({
      fields: tkInputs?.fields ?? {},
      action: tkInputs?.action ?? "",
      file: uploadedFilePath ?? "",
    });
    if (uploadedFilePath) env.PYEXEC_TK_FILE = uploadedFilePath;
  }

  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, ...finalArgs], {
      timeout: 60000,
      env,
      cwd: tmpDir,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("close", async (code: number | null) => {
      const executionTimeMs = Date.now() - start;
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      resolve({
        success: code === 0,
        stdout: stdout.slice(0, 50000),
        stderr: stderr.slice(0, 10000),
        exitCode: code ?? -1,
        executionTimeMs,
        deps,
      });
    });

    proc.on("error", async (err: Error) => {
      const executionTimeMs = Date.now() - start;
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      resolve({
        success: false,
        stdout: "",
        stderr: err.message,
        exitCode: -1,
        executionTimeMs,
        deps,
      });
    });
  });
}

router.get("/scripts/:id/inputs", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });

    if (me.role !== "admin" && script.departmentId !== null && script.departmentId !== me.departmentId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = parseScriptInputs(script.code);
    res.json(schema);
  } catch (err) {
    req.log.error({ err }, "Error parsing script inputs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/scripts/:id/dependencies", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });
    if (me.role !== "admin" && script.departmentId !== null && script.departmentId !== me.departmentId) {
      return res.status(403).json({ error: "Access denied" });
    }
    const deps = await checkDependencies(script.code);
    res.json({ deps });
  } catch (err) {
    req.log.error({ err }, "Error checking dependencies");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/scripts/:id/dependencies/install", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });
    if (me.role !== "admin" && script.departmentId !== null && script.departmentId !== me.departmentId) {
      return res.status(403).json({ error: "Access denied" });
    }
    await logAudit({ req, userId, userEmail: me.email, action: "script.deps_install", resourceType: "script", resourceId: id, details: { scriptName: script.name } });
    const result = await installDependencies(script.code);
    const deps = await checkDependencies(script.code);
    res.json({ result, deps });
  } catch (err) {
    req.log.error({ err }, "Error installing dependencies");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/scripts/:id/execute-stream", requireAuth, uploadAny, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  let me: any;
  let script: any;
  try {
    me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });
    if (me.role !== "admin" && script.departmentId !== null && script.departmentId !== me.departmentId) {
      await logAudit({ req, userId, userEmail: me.email, action: "script.execute_denied", resourceType: "script", resourceId: id });
      return res.status(403).json({ error: "Access denied" });
    }
  } catch (err) {
    req.log.error({ err }, "Auth error in execute-stream");
    return res.status(500).json({ error: "Internal server error" });
  }

  // Parse inputs (same logic as /execute)
  let args: string[] = [];
  let stdin: string | null | undefined = undefined;
  let tkInputs: { fields?: Record<string, string>; action?: string } | null = null;
  const allFiles = ((req as any).files ?? []) as Array<{ fieldname: string; buffer: Buffer; originalname: string }>;
  const file = allFiles.find((f) => f.fieldname === "file");
  const pathFiles = allFiles.filter((f) => f.fieldname.startsWith("pathFile_"));
  const parseTk = (raw: unknown) => {
    if (!raw) return null;
    try {
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (obj && typeof obj === "object") {
        return {
          fields: (obj as any).fields && typeof (obj as any).fields === "object" ? (obj as any).fields : {},
          action: typeof (obj as any).action === "string" ? (obj as any).action : "",
        };
      }
    } catch { /* ignore */ }
    return null;
  };
  const isMultipart = allFiles.length > 0 || (typeof req.body?.args === "string");
  if (isMultipart) {
    const rawArgs = (req.body?.args ?? "[]");
    try { args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs; }
    catch { args = []; }
    stdin = req.body?.stdin || null;
    tkInputs = parseTk(req.body?.tkInputs);
  } else {
    args = req.body?.args ?? [];
    stdin = req.body?.stdin ?? null;
    tkInputs = parseTk(req.body?.tkInputs);
  }
  if (!Array.isArray(args)) args = [];

  // Parse pathOverrides: [{ literal: "...", index: 0 }]
  let pathOverridesIn: Array<{ literal: string; index: number }> = [];
  try {
    const raw = req.body?.pathOverrides;
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) pathOverridesIn = parsed;
    }
  } catch { /* ignore */ }

  // Setup NDJSON streaming response
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (obj: any) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };

  await logAudit({ req, userId, userEmail: me.email, action: "script.execute_start", resourceType: "script", resourceId: id, details: { scriptName: script.name, hasFile: !!file, gui: !!tkInputs, streaming: true } });

  send({ type: "status", message: "Preparing execution environment..." });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyexec-"));

  // Save extra path-override files and build code substitutions
  const overrideTargets: { literal: string; replacementPath: string; label: string }[] = [];
  for (const ov of pathOverridesIn) {
    const f = pathFiles.find((pf) => pf.fieldname === `pathFile_${ov.index}`);
    if (!f) continue;
    const safeName = f.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest = path.join(tmpDir, `override_${ov.index}_${safeName}`);
    await fs.writeFile(dest, f.buffer);
    overrideTargets.push({ literal: ov.literal, replacementPath: dest, label: safeName });
  }

  let userCode = script.code;
  if (overrideTargets.length > 0) {
    const { code: rewritten, replaced } = applyPathOverrides(userCode, overrideTargets);
    userCode = rewritten;
    for (const r of replaced) {
      send({ type: "status", message: `Replaced hard-coded path ${r.literal} → uploaded file` });
    }
  }

  const useShim = !!tkInputs;
  const finalCode = useShim ? `${tkShimSource}\n# === USER SCRIPT ===\n${userCode}` : userCode;
  const scriptPath = path.join(tmpDir, "script.py");
  await fs.writeFile(scriptPath, finalCode, "utf-8");

  let finalArgs = [...args.map(String)];
  let uploadedFilePath: string | null = null;
  const FILE_PATH_SENTINEL = "__PYEXEC_UPLOADED_FILE_PATH__";
  if (file?.buffer && file?.originalname) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    uploadedFilePath = path.join(tmpDir, safeName);
    await fs.writeFile(uploadedFilePath, file.buffer);
    send({ type: "status", message: `Saved uploaded file: ${safeName}` });
    // If the frontend marked an interactive prompt slot for the file path,
    // substitute the sentinel in stdin and skip argv-append.
    const stdinHasSentinel = typeof stdin === "string" && stdin.includes(FILE_PATH_SENTINEL);
    if (stdinHasSentinel) {
      stdin = (stdin as string).split(FILE_PATH_SENTINEL).join(uploadedFilePath);
      send({ type: "status", message: "Injecting uploaded file path into interactive prompt." });
    } else if (!useShim) {
      // Legacy path: append to argv for scripts that read sys.argv[1].
      finalArgs.push(uploadedFilePath);
    }
  }

  send({ type: "status", message: "Checking Python dependencies..." });
  const deps = await ensureDependencies(script.code);
  if (deps.installed.length > 0) {
    send({ type: "status", message: `Installed packages: ${deps.installed.join(", ")}` });
  }
  if (deps.failed.length > 0) {
    for (const f of deps.failed) {
      send({ type: "stderr", data: `[deps] Failed to install ${f.pkg}: ${f.error.slice(0, 200)}\n` });
    }
  }

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: os.tmpdir(),
    TMPDIR: os.tmpdir(),
    PYTHONPATH: getDepsDir(),
    PYTHONUNBUFFERED: "1",
  };
  if (useShim) {
    env.PYEXEC_TK_INPUTS = JSON.stringify({
      fields: tkInputs?.fields ?? {},
      action: tkInputs?.action ?? "",
      file: uploadedFilePath ?? "",
    });
    if (uploadedFilePath) env.PYEXEC_TK_FILE = uploadedFilePath;
  }

  send({ type: "status", message: `Running: python3 script.py ${finalArgs.join(" ")}`.trim() });

  const start = Date.now();
  const proc = spawn("python3", ["-u", scriptPath, ...finalArgs], {
    timeout: 60000,
    env,
    cwd: tmpDir,
  });

  let stdoutBuf = "";
  let stderrBuf = "";

  proc.stdout.on("data", (d: Buffer) => {
    const s = d.toString();
    stdoutBuf += s;
    send({ type: "stdout", data: s });
  });
  proc.stderr.on("data", (d: Buffer) => {
    const s = d.toString();
    stderrBuf += s;
    send({ type: "stderr", data: s });
  });

  if (stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  } else {
    proc.stdin.end();
  }

  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
    if (proc.exitCode === null && !proc.killed) {
      proc.kill("SIGTERM");
    }
  });

  proc.on("error", async (err: Error) => {
    const executionTimeMs = Date.now() - start;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    send({ type: "stderr", data: `[runtime] ${err.message}\n` });
    send({
      type: "done",
      result: {
        success: false,
        stdout: stdoutBuf.slice(0, 50000),
        stderr: (stderrBuf + err.message).slice(0, 10000),
        exitCode: -1,
        executionTimeMs,
        executionId: null,
        deps,
      },
    });
    if (!res.writableEnded) res.end();
  });

  proc.on("close", async (code: number | null) => {
    const executionTimeMs = Date.now() - start;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    let executionId: number | null = null;
    try {
      const [execution] = await db.insert(executionsTable).values({
        scriptId: id,
        executedBy: userId,
        success: code === 0,
        stdout: stdoutBuf.slice(0, 50000),
        stderr: stderrBuf.slice(0, 10000),
        exitCode: code ?? -1,
        executionTimeMs,
      }).returning();
      executionId = execution.id;
      await logAudit({
        req, userId, userEmail: me.email,
        action: code === 0 ? "script.execute_success" : "script.execute_failure",
        resourceType: "script", resourceId: id,
        details: { scriptName: script.name, exitCode: code ?? -1, executionTimeMs },
      });
    } catch (e: any) {
      req.log.error({ err: e }, "Failed to record execution");
    }
    if (clientClosed) return;
    send({
      type: "done",
      result: {
        success: code === 0,
        stdout: stdoutBuf.slice(0, 50000),
        stderr: stderrBuf.slice(0, 10000),
        exitCode: code ?? -1,
        executionTimeMs,
        executionId,
        deps,
      },
    });
    if (!res.writableEnded) res.end();
  });
});

router.post("/scripts/:id/execute", requireAuth, upload.single("file"), async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });

    if (me.role !== "admin" && script.departmentId !== null && script.departmentId !== me.departmentId) {
      await logAudit({ req, userId, userEmail: me.email, action: "script.execute_denied", resourceType: "script", resourceId: id });
      return res.status(403).json({ error: "Access denied" });
    }

    let args: string[] = [];
    let stdin: string | null | undefined = undefined;
    let tkInputs: { fields?: Record<string, string>; action?: string } | null = null;
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;

    const parseTk = (raw: unknown) => {
      if (!raw) return null;
      try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (obj && typeof obj === "object") {
          return {
            fields: (obj as any).fields && typeof (obj as any).fields === "object" ? (obj as any).fields : {},
            action: typeof (obj as any).action === "string" ? (obj as any).action : "",
          };
        }
      } catch { /* ignore */ }
      return null;
    };

    if (file) {
      const rawArgs = (req.body?.args ?? "[]");
      try { args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs; }
      catch { args = []; }
      stdin = req.body?.stdin || null;
      tkInputs = parseTk(req.body?.tkInputs);
    } else {
      args = req.body?.args ?? [];
      stdin = req.body?.stdin ?? null;
      tkInputs = parseTk(req.body?.tkInputs);
    }
    if (!Array.isArray(args)) args = [];

    await logAudit({ req, userId, userEmail: me.email, action: "script.execute_start", resourceType: "script", resourceId: id, details: { scriptName: script.name, hasFile: !!file, gui: !!tkInputs } });

    const result = await runPython(
      script.code,
      args.map(String),
      stdin,
      file?.buffer ?? null,
      file?.originalname ?? null,
      tkInputs,
    );

    const [execution] = await db.insert(executionsTable).values({
      scriptId: id,
      executedBy: userId,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
    }).returning();

    await logAudit({
      req, userId, userEmail: me.email,
      action: result.success ? "script.execute_success" : "script.execute_failure",
      resourceType: "script", resourceId: id,
      details: {
        scriptName: script.name,
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
      },
    });

    res.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
      executionId: execution.id,
      deps: result.deps,
    });
  } catch (err) {
    req.log.error({ err }, "Error executing script");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
