import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { aiGenerateText } from "../lib/aiClient";
import { detectLanguage } from "../lib/scriptLanguage";

const router = Router();

export type AiFixProposal = {
  diagnosis: string;
  rootCause: string;
  changes: string[];
  fixedCode: string;
  confidence: "low" | "medium" | "high";
  notes?: string;
  language?: string;
  generatedAt: string;
};

function buildSystemPrompt(languageName: string, fenceTag: string, runnable: boolean, unrunnableReason: string | undefined): string {
  const langSpecific: Record<string, string> = {
    Python: "- Preserve the script's input/argparse/Tkinter form contract — do not rename CLI args, form labels, or button labels.",
    "Bash / Shell": "- Quote variable expansions properly. Use `set -euo pipefail` only if the original script already does.",
    "JavaScript (Node.js)": "- Keep CommonJS vs ESM style consistent with the original. Do not convert require ↔ import.",
    PowerShell: "- Preserve param() blocks, parameter names, types and validation attributes exactly.",
    "Windows Batch": "- Use the .bat / .cmd dialect of cmd.exe. Use REM for comments. Preserve label names and goto targets.",
    VBScript: "- Use classic VBScript syntax (Dim, Set, CreateObject, WScript.*). No .NET-specific constructs.",
    "VBA / Office Macro": "- Use VBA for Office syntax. Preserve Sub / Function / End Sub structure and any Option Explicit / Option Compare directives.",
    HTML: "- Keep the existing CSS class names, ids and JavaScript event handler names intact. Do not strip user content.",
    SQL: "- Preserve table and column names exactly. Do not invent new objects unless they are clearly missing from the original schema.",
  };
  const guidance = langSpecific[languageName] ?? "- Preserve the script's structure, identifiers and external contracts (function names, CLI args, ids).";
  const runtimeNote = runnable
    ? `The script is run with the appropriate ${languageName} interpreter on the server.`
    : `IMPORTANT: ${unrunnableReason ?? `${languageName} cannot be executed directly on this server`} The "error output" you receive is the server's explanation, NOT a runtime error from the interpreter. Focus on improving the source itself — fixing syntax, logic, modernising APIs, and making it ready to run on its native platform.`;

  return `You are an expert ${languageName} engineer and debugger. The user will give you a ${languageName} file and the error output associated with it. Your job is to diagnose the problem and produce a corrected, runnable version of the full file.

${runtimeNote}

You MUST respond with ONLY a valid JSON object (no prose, no markdown fences) matching this TypeScript shape:
{
  "diagnosis": string,        // 1-3 sentences in plain English: what went wrong
  "rootCause": string,        // 1 sentence: the underlying cause
  "changes": string[],        // bullet list (3-8 items) of the specific edits you made
  "fixedCode": string,        // the COMPLETE corrected ${languageName} source — full file, ready to save and run
  "confidence": "low" | "medium" | "high",
  "notes": string             // optional: caveats, things the user should verify
}

Rules:
- Always return the FULL fixed file in "fixedCode", not a diff or snippet.
- Keep the original file's structure and intent. Make the smallest change that fixes the error.
- Do not invent new dependencies / imports / modules / external scripts unless absolutely required. If you must, mention it in "notes".
- If the error is environmental (missing file, missing env var, network down, missing interpreter), explain that in "diagnosis" and return the original code with a clear ${fenceTag || "code"}-style comment at the top describing what to fix outside the file. Set confidence to "low".
- If the file is already correct and the error looks transient or caused by the runtime/host, say so in "diagnosis", set confidence to "low", and return the original code unchanged.
${guidance}
- Never include API keys, secrets, or hardcoded credentials in the fix.
- Output JSON only.`;
}

router.post("/scripts/:id/ai-fix-error", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    // Light AI Auto-Fix is a universal feature — anyone authenticated who can
    // run the script can ask Light AI to analyse the failure. Apply step below
    // also accepts non-admins so the auto-fix loop completes end-to-end.

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });

    const body = req.body || {};
    const stderr = typeof body.stderr === "string" ? body.stderr : "";
    const stdout = typeof body.stdout === "string" ? body.stdout : "";
    const exitCode = typeof body.exitCode === "number" ? body.exitCode : null;

    if (!stderr.trim() && !stdout.trim() && exitCode === null) {
      return res.status(400).json({ error: "Provide stderr, stdout, or exitCode from the failed run." });
    }

    const lang = detectLanguage(script.filename, script.code);
    const commentToken = lang.comment;
    const truncationComment = `${commentToken} ...[truncated for AI prompt]`;
    const trimmedCode = script.code.length > 16000
      ? script.code.slice(0, 16000) + "\n" + truncationComment
      : script.code;
    const trimmedStderr = stderr.length > 6000 ? stderr.slice(-6000) : stderr;
    const trimmedStdout = stdout.length > 4000 ? stdout.slice(-4000) : stdout;

    const SYSTEM_PROMPT = buildSystemPrompt(lang.displayName, lang.fenceTag, lang.runnable, lang.unrunnableReason);

    const userPrompt = `File name: ${script.name}
Filename on disk: ${script.filename}
Detected language: ${lang.displayName}
Description: ${script.description ?? "(none)"}
Exit code: ${exitCode ?? "(unknown)"}

--- STDERR ---
${trimmedStderr || "(empty)"}

--- STDOUT (last lines) ---
${trimmedStdout || "(empty)"}

--- ${lang.displayName.toUpperCase()} SOURCE ---
\`\`\`${lang.fenceTag}
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
            language: lang.displayName,
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
    // Light AI Auto-Fix applies to any authenticated user. The audit trail
    // records who applied the fix.

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
