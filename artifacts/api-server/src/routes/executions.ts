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
import { parseScriptInputs } from "../lib/scriptParser";
import { ensureDependencies, getDepsDir, type DepInstallResult } from "../lib/pythonDeps";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function runPython(code: string, args: string[] = [], stdin?: string | null, fileBuffer?: Buffer | null, fileName?: string | null): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  deps: DepInstallResult;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyexec-"));
  const scriptPath = path.join(tmpDir, "script.py");
  await fs.writeFile(scriptPath, code, "utf-8");

  let finalArgs = [...args];
  if (fileBuffer && fileName) {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(tmpDir, safeName);
    await fs.writeFile(filePath, fileBuffer);
    finalArgs.push(filePath);
  }

  const deps = await ensureDependencies(code);

  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, ...finalArgs], {
      timeout: 60000,
      env: {
        PATH: process.env.PATH,
        HOME: os.tmpdir(),
        TMPDIR: os.tmpdir(),
        PYTHONPATH: getDepsDir(),
      },
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
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;

    if (file) {
      const rawArgs = (req.body?.args ?? "[]");
      try { args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs; }
      catch { args = []; }
      stdin = req.body?.stdin || null;
    } else {
      args = req.body?.args ?? [];
      stdin = req.body?.stdin ?? null;
    }
    if (!Array.isArray(args)) args = [];

    await logAudit({ req, userId, userEmail: me.email, action: "script.execute_start", resourceType: "script", resourceId: id, details: { scriptName: script.name, hasFile: !!file } });

    const result = await runPython(
      script.code,
      args.map(String),
      stdin,
      file?.buffer ?? null,
      file?.originalname ?? null,
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
