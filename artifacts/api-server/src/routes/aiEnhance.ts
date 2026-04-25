import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { parseScriptInputs } from "../lib/scriptParser";
import { aiGenerateText } from "../lib/aiClient";
import { detectLanguage } from "../lib/scriptLanguage";

const router = Router();

export type AiFieldHint = {
  label: string;
  friendlyLabel?: string;
  description?: string;
  placeholder?: string;
  validation?: string;
  example?: string;
};

export type AiActionHint = {
  label: string;
  friendlyLabel?: string;
  description?: string;
};

export type AiPathHint = {
  literal: string;
  friendlyLabel?: string;
  description?: string;
};

export type ReconciledField = {
  label: string;
  kind: "text" | "password" | "number" | "select" | "checkbox" | "textarea";
  source: "parser" | "ai_added";
  friendlyLabel?: string;
  description?: string;
  placeholder?: string;
  example?: string;
  validation?: string;
};

export type AiEnhancedSchema = {
  scriptTitle?: string;
  scriptSummary?: string;
  fields?: AiFieldHint[];
  args?: AiFieldHint[];
  actions?: AiActionHint[];
  paths?: AiPathHint[];
  warnings?: string[];
  reconciledFields?: ReconciledField[];
  codeChanges?: string[];
  codeEnhanced?: boolean;
  generatedAt: string;
};

const SYSTEM_PROMPT = `You are JARVIS — an expert Python code analyst and engineer embedded inside PyExec Portal, an enterprise Python execution platform.

Your job when called with a Python script:

PART A — FIELD RECONCILIATION
You receive the list of form fields the automatic parser detected. You MUST:
1. Read the full Python source carefully.
2. Produce "reconciledFields" — the DEFINITIVE, correct list of every input field the script needs to run.
   - Include fields the parser found AND they are actually used → keep them (source: "parser")
   - Include fields the parser MISSED but the script actually needs → add them (source: "ai_added")
   - EXCLUDE fields the parser found but that are NOT actually needed / are auto-generated / hardcoded → drop them silently
   - Each field must have: label (exact string the shim will match), kind, source, and optionally friendlyLabel / description / placeholder / example
   - kind must be one of: "text", "password", "number", "select", "checkbox", "textarea"
   - Use "password" kind for any field that takes a password, secret, token, PIN
   - Use "number" for numeric inputs
   - The "label" must EXACTLY match the prompt string from the code so the execution shim can look it up (e.g. simpledialog.askstring("Title", "Enter Username:") → label: "Enter Username")

PART B — CODE ENHANCEMENT
You must also improve the Python script. Make it more robust, production-ready, and informative:
1. Add clear print() statements so the user can see progress (e.g. "Processing row 5/120...")
2. Add try/except blocks around network calls and file operations
3. Add input validation (check files exist, fields are not empty, etc.)
4. Improve error messages — be specific about what went wrong
5. Keep all existing logic exactly intact — only ADD improvements, never remove/change core functionality
6. Return the COMPLETE improved Python script in "enhancedCode"
7. List each improvement in "codeChanges" array (short bullets)

PART C — WARNINGS
In "warnings", flag:
- Destructive or irreversible operations (bulk writes, deletes, API mutations)
- External API calls and what data they send
- Hardcoded credentials, tenant IDs, or magic numbers that may need changing
- Any remaining risks the user should know before running

You MUST respond with ONLY a valid JSON object (no markdown, no prose):
{
  "scriptTitle": string,
  "scriptSummary": string,
  "reconciledFields": [
    {
      "label": string,
      "kind": "text" | "password" | "number" | "select" | "checkbox" | "textarea",
      "source": "parser" | "ai_added",
      "friendlyLabel": string,
      "description": string,
      "placeholder": string,
      "example": string,
      "validation": string
    }
  ],
  "fields": [
    { "label": string, "friendlyLabel": string, "description": string, "placeholder": string, "validation": string, "example": string }
  ],
  "args": [
    { "label": string, "friendlyLabel": string, "description": string, "placeholder": string, "validation": string, "example": string }
  ],
  "actions": [
    { "label": string, "friendlyLabel": string, "description": string }
  ],
  "paths": [
    { "literal": string, "friendlyLabel": string, "description": string }
  ],
  "warnings": string[],
  "enhancedCode": string,
  "codeChanges": string[]
}

Critical rules:
- "reconciledFields[].label" must exactly match the prompt/label string used in the code
- Never invent labels that aren't grounded in actual code
- Keep friendlyLabel/description under 120 chars, end-user friendly
- enhancedCode must be COMPLETE runnable Python — never truncate it
- If you cannot improve the code meaningfully, still return it unchanged in enhancedCode`;

const GENERIC_SYSTEM_PROMPT = (langName: string, fenceTag: string, runnable: boolean, unrunnableReason: string | undefined) => `You are JARVIS — an expert ${langName} engineer embedded inside PyExec Portal, an enterprise script execution platform.

Your job when called with a ${langName} file is to make it more robust, production-ready, and informative.

CODE ENHANCEMENT
1. Add clear progress logging using the language's idiomatic output mechanism.
2. Add error handling around any I/O, network call, file operation, external command or destructive operation.
3. Add input validation (check files exist, parameters are not empty, expected types, etc.).
4. Improve error messages — be specific about what went wrong and how to fix it.
5. Keep all existing logic exactly intact — only ADD improvements, never remove or change core functionality.
6. Respect the language's conventions and idioms (do not, for example, convert PowerShell to Python).
7. Return the COMPLETE improved ${langName} file in "enhancedCode".
8. List each improvement in "codeChanges" array (short bullets, 3-10 items).

WARNINGS
In "warnings", flag:
- Destructive or irreversible operations (bulk writes, deletes, API mutations, registry changes, sending emails, etc.)
- External API calls and what data they send
- Hardcoded credentials, tenant IDs, environment-specific paths or magic numbers
- Anything that requires special privileges (admin, sudo, root)
- Any remaining risks the user should know before running

${runnable ? "" : `RUNTIME NOTE: ${unrunnableReason ?? `${langName} cannot be executed directly on this server.`} Still produce the best possible enhanced source — the user will run it on its native platform.`}

You MUST respond with ONLY a valid JSON object (no markdown, no prose):
{
  "scriptTitle": string,
  "scriptSummary": string,
  "warnings": string[],
  "enhancedCode": string,
  "codeChanges": string[]
}

Critical rules:
- enhancedCode must be COMPLETE runnable ${langName} — never truncate it
- The code fence for the file is \`\`\`${fenceTag || "text"}
- If you cannot improve the code meaningfully, still return it unchanged in enhancedCode and explain why in scriptSummary
- Do not invent dependencies or imports unless absolutely required`;

router.post("/scripts/:id/ai-enhance", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });
    if (me.role !== "admin") {
      return res.status(403).json({ error: "Only admins can enhance scripts" });
    }

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Script not found" });

    const lang = detectLanguage(script.filename, script.code);
    const isPython = lang.id === "python";
    const truncationComment = `${lang.comment} ...[truncated]`;
    const trimmedCode = script.code.length > 16000
      ? script.code.slice(0, 16000) + "\n" + truncationComment
      : script.code;

    let systemPrompt: string;
    let userPrompt: string;

    if (isPython) {
      // Python: full reconciliation flow (uses Tkinter / argparse parser)
      const parsed = parseScriptInputs(script.code);
      const currentFields = parsed.tkForm?.fields.map((f) => ({ label: f.label, kind: f.kind })) ?? [];
      const summary = {
        args: parsed.args.map((a) => ({ label: a.label, type: a.type, help: a.help, required: a.required })),
        currentParsedFields: currentFields,
        tkActions: parsed.tkForm?.actions.map((a) => ({ label: a.label })) ?? [],
        hasFile: !!parsed.file || !!parsed.tkForm?.needsFile,
        hardcodedPaths: parsed.hardcodedPaths.map((p) => ({ literal: p.literal, path: p.path, kind: p.kind, func: p.func })),
      };

      systemPrompt = SYSTEM_PROMPT;
      userPrompt = `Script name: ${script.name}
Existing description: ${script.description ?? "(none)"}

CURRENT PARSER OUTPUT (may be wrong or incomplete — you must verify against the source):
${JSON.stringify(summary, null, 2)}

INSTRUCTION:
- "currentParsedFields" lists what the parser detected. Cross-check against the source code below.
- Produce "reconciledFields" as the definitive truth: keep what's correct, add what's missing, drop what's wrong.
- Produce "enhancedCode" with the improved, production-ready version of this script.

Python source code:
\`\`\`python
${trimmedCode}
\`\`\`

Respond with ONLY the JSON object described in the system prompt.`;
    } else {
      // Generic enhancement — no Python-specific field reconciliation
      systemPrompt = GENERIC_SYSTEM_PROMPT(lang.displayName, lang.fenceTag, lang.runnable, lang.unrunnableReason);
      userPrompt = `File name: ${script.name}
Filename on disk: ${script.filename}
Detected language: ${lang.displayName}
Existing description: ${script.description ?? "(none)"}

INSTRUCTION:
- Improve this ${lang.displayName} file as described in the system prompt.
- Return the COMPLETE improved file in "enhancedCode".

${lang.displayName} source:
\`\`\`${lang.fenceTag}
${trimmedCode}
\`\`\`

Respond with ONLY the JSON object described in the system prompt.`;
    }

    const { text } = await aiGenerateText({
      systemPrompt,
      userPrompt,
      maxTokens: 16000,
    });

    let parsedSchema: (AiEnhancedSchema & { enhancedCode?: string }) | null = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedSchema = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      req.log.warn({ err: e, text: text.slice(0, 500) }, "Failed to parse AI response as JSON");
    }

    if (!parsedSchema) {
      return res.status(502).json({ error: "AI returned an unparseable response. Please try again.", raw: text.slice(0, 500) });
    }

    // Extract enhanced code separately (don't persist it in aiSchema blob)
    const enhancedCode: string | undefined = (parsedSchema as any).enhancedCode;
    delete (parsedSchema as any).enhancedCode;

    // Mark reconciliation metadata
    parsedSchema.codeEnhanced = !!(enhancedCode && enhancedCode.trim().length > 50);
    parsedSchema.generatedAt = new Date().toISOString();

    // Normalise reconciledFields — ensure every entry has required keys
    if (parsedSchema.reconciledFields) {
      parsedSchema.reconciledFields = parsedSchema.reconciledFields
        .filter((f) => f && typeof f.label === "string" && f.label.trim())
        .map((f) => ({
          ...f,
          label: f.label.trim(),
          kind: (["text", "password", "number", "select", "checkbox", "textarea"].includes(f.kind) ? f.kind : "text") as ReconciledField["kind"],
          source: f.source === "ai_added" ? "ai_added" : "parser",
        }));
    }

    // Persist aiSchema (without enhanced code — that goes to script.code)
    const updates: Record<string, any> = {
      aiSchema: parsedSchema,
      updatedAt: new Date(),
    };

    // Apply enhanced code back to the script if AI produced one
    if (enhancedCode && enhancedCode.trim().length > 50) {
      updates.code = enhancedCode.trim();
    }

    await db.update(scriptsTable)
      .set(updates)
      .where(eq(scriptsTable.id, id));

    await logAudit({
      req, userId, userEmail: me.email,
      action: "script.ai_enhance",
      resourceType: "script",
      resourceId: id,
      details: {
        scriptName: script.name,
        fields: parsedSchema.fields?.length ?? 0,
        reconciledFields: parsedSchema.reconciledFields?.length ?? 0,
        codeEnhanced: parsedSchema.codeEnhanced,
        codeChanges: parsedSchema.codeChanges?.length ?? 0,
      },
    });

    res.json({ aiSchema: parsedSchema, codeEnhanced: parsedSchema.codeEnhanced });
  } catch (err: any) {
    req.log.error({ err }, "Error in AI enhance");
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

router.get("/scripts/:id/ai-schema", requireAuth, async (req, res) => {
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
    res.json({ aiSchema: script.aiSchema ?? null });
  } catch (err) {
    req.log.error({ err }, "Error fetching AI schema");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
