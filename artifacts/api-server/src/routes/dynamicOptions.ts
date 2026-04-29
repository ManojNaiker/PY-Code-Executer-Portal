import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import { requireAuth } from "../middlewares/requireAuth";
import { userCanAccessScript } from "../lib/scriptAccess";
import { ensureDependencies, getDepsDir } from "../lib/pythonDeps";
import tkShimSource from "../lib/tkShim.py";

const router = Router();

const DYNAMIC_OPTIONS_TIMEOUT_MS = 45000;

router.post("/scripts/:id/dynamic-options", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });
    if (!(await userCanAccessScript({ role: me.role, departmentId: me.departmentId }, script.id))) {
      return res.status(403).json({ error: "Access denied" });
    }

    const body = req.body || {};
    const func = typeof body.func === "string" ? body.func.trim() : "";
    if (!func || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(func)) {
      return res.status(400).json({ error: "Valid 'func' name is required" });
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyexec-opts-"));
    const finalCode = `${tkShimSource}\n# === USER SCRIPT ===\n${script.code}`;
    const scriptPath = path.join(tmpDir, "script.py");
    await fs.writeFile(scriptPath, finalCode, "utf-8");

    try {
      await ensureDependencies(script.code);
    } catch {
      // best effort — let the run fail with a clearer error if needed
    }

    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: os.tmpdir(),
      TMPDIR: os.tmpdir(),
      PYTHONPATH: getDepsDir(),
      PYEXEC_TK_LIST_OPTIONS: func,
      // Provide an empty inputs payload so any code paths that read it don't crash
      PYEXEC_TK_INPUTS: JSON.stringify({ fields: {}, action: "", file: "" }),
    };

    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const proc = spawn("python3", [scriptPath], {
        timeout: DYNAMIC_OPTIONS_TIMEOUT_MS,
        env,
        cwd: tmpDir,
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ stdout, stderr, code }));
      proc.on("error", (err) => resolve({ stdout, stderr: err.message, code: -1 }));
      proc.stdin.end();
    });

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    // Find the last JSON line containing __pyexec_options__ or __pyexec_options_error__
    const lines = result.stdout.split("\n").reverse();
    let parsed: { __pyexec_options__?: string[]; __pyexec_options_error__?: string } | null = null;
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("{") || !t.endsWith("}")) continue;
      try {
        const obj = JSON.parse(t);
        if (obj && (Array.isArray(obj.__pyexec_options__) || typeof obj.__pyexec_options_error__ === "string")) {
          parsed = obj;
          break;
        }
      } catch {
        // skip non-JSON lines
      }
    }

    if (!parsed) {
      return res.status(502).json({
        error: "Could not load options",
        detail: result.stderr.slice(-500) || "No options output from script",
      });
    }
    if (parsed.__pyexec_options_error__) {
      return res.status(502).json({
        error: "Script failed while listing options",
        detail: parsed.__pyexec_options_error__,
      });
    }

    res.json({ options: parsed.__pyexec_options__ ?? [] });
  } catch (err: any) {
    req.log.error({ err }, "Error fetching dynamic options");
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;
