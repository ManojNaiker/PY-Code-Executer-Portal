import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { aiGenerateText } from "../lib/aiClient";

const router = Router();

export type AiFixProposal = {
  diagnosis: string;
  rootCause: string;
  changes: string[];
  fixedCode: string;
  confidence: "low" | "medium" | "high";
  notes?: string;
  generatedAt: string;
};

const SYSTEM_PROMPT = `You are an expert Python debugging engineer. The user will give you a Python script and the error output it produced when executed. Your job is to diagnose the problem and produce a corrected, runnable version of the full script.

You MUST respond with ONLY a valid JSON object (no prose, no markdown fences) matching this TypeScript shape:
{
  "diagnosis": string,        // 1-3 sentences in plain English: what went wrong
  "rootCause": string,        // 1 sentence: the underlying cause (e.g. "NameError: variable used before assignment")
  "changes": string[],        // bullet list (3-8 items) of the specific edits you made
  "fixedCode": string,        // the COMPLETE corrected Python source — full file, ready to save and run
  "confidence": "low" | "medium" | "high",
  "notes": string             // optional: caveats, things the user should verify
}

Rules:
- Always return the FULL fixed script in "fixedCode", not a diff or snippet.
- Keep the original script's structure and intent. Make the smallest change that fixes the error.
- Do not invent new dependencies unless absolutely required. If you must, mention it in "notes".
- If the error is environmental (missing file, missing env var, network down), explain that in "diagnosis" and return the original code with comments at the top describing what to fix outside the script. Set confidence to "low".
- If the script is already correct and the error looks transient, say so in "diagnosis", set confidence to "low", and return the original code unchanged.
- Preserve the script's input/argparse/Tkinter form contract — do not rename CLI args, form labels, or button labels.
- Never include API keys, secrets, or hardcoded credentials in the fix.
- Output JSON only.`;

router.post("/scripts/:id/ai-fix-error", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    if (me.role !== "admin") {
      return res.status(403).json({ error: "Only admins can use AI fix" });
    }

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });

    const body = req.body || {};
    const stderr = typeof body.stderr === "string" ? body.stderr : "";
    const stdout = typeof body.stdout === "string" ? body.stdout : "";
    const exitCode = typeof body.exitCode === "number" ? body.exitCode : null;

    if (!stderr.trim() && !stdout.trim() && exitCode === null) {
      return res.status(400).json({ error: "Provide stderr, stdout, or exitCode from the failed run." });
    }

    const trimmedCode = script.code.length > 16000
      ? script.code.slice(0, 16000) + "\n# ...[truncated for AI prompt]"
      : script.code;
    const trimmedStderr = stderr.length > 6000 ? stderr.slice(-6000) : stderr;
    const trimmedStdout = stdout.length > 4000 ? stdout.slice(-4000) : stdout;

    const userPrompt = `Script name: ${script.name}
Filename: ${script.filename}
Description: ${script.description ?? "(none)"}
Exit code: ${exitCode ?? "(unknown)"}

--- STDERR ---
${trimmedStderr || "(empty)"}

--- STDOUT (last lines) ---
${trimmedStdout || "(empty)"}

--- PYTHON SOURCE ---
\`\`\`python
${trimmedCode}
\`\`\`

Diagnose and return ONLY the JSON object described in the system prompt.`;

    const { text, provider, model } = await aiGenerateText({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 8192,
    });

    let proposal: AiFixProposal | null = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const obj = JSON.parse(jsonMatch[0]);
        if (typeof obj.fixedCode === "string" && typeof obj.diagnosis === "string") {
          proposal = {
            diagnosis: String(obj.diagnosis),
            rootCause: String(obj.rootCause ?? ""),
            changes: Array.isArray(obj.changes) ? obj.changes.map(String).slice(0, 20) : [],
            fixedCode: String(obj.fixedCode),
            confidence: ["low", "medium", "high"].includes(obj.confidence) ? obj.confidence : "medium",
            notes: typeof obj.notes === "string" ? obj.notes : undefined,
            generatedAt: new Date().toISOString(),
          };
        }
      }
    } catch (e) {
      req.log.warn({ err: e, text: text.slice(0, 500) }, "Failed to parse AI fix response");
    }

    if (!proposal) {
      return res.status(502).json({ error: "AI returned an unparseable response. Please try again.", raw: text.slice(0, 500) });
    }

    await logAudit({
      req, userId, userEmail: me.email,
      action: "script.ai_fix_proposed",
      resourceType: "script",
      resourceId: id,
      details: { scriptName: script.name, provider, model, confidence: proposal.confidence, changes: proposal.changes.length },
    });

    res.json({ proposal, provider, model, originalCode: script.code });
  } catch (err: any) {
    req.log.error({ err }, "Error in AI fix");
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

router.post("/scripts/:id/ai-fix-error/apply", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    if (me.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });

    const body = req.body || {};
    const fixedCode = typeof body.fixedCode === "string" ? body.fixedCode : "";
    if (!fixedCode.trim()) {
      return res.status(400).json({ error: "fixedCode is required" });
    }
    if (fixedCode === script.code) {
      return res.status(400).json({ error: "Fixed code is identical to the current code" });
    }

    const [updated] = await db.update(scriptsTable)
      .set({ code: fixedCode, aiSchema: null, updatedAt: new Date() })
      .where(eq(scriptsTable.id, id))
      .returning();

    await logAudit({
      req, userId, userEmail: me.email,
      action: "script.ai_fix_applied",
      resourceType: "script",
      resourceId: id,
      details: { scriptName: script.name, oldLength: script.code.length, newLength: fixedCode.length },
    });

    res.json({ script: updated });
  } catch (err: any) {
    req.log.error({ err }, "Error applying AI fix");
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;
