import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { parseScriptInputs } from "../lib/scriptParser";

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

export type AiEnhancedSchema = {
  scriptTitle?: string;
  scriptSummary?: string;
  fields?: AiFieldHint[];
  args?: AiFieldHint[];
  actions?: AiActionHint[];
  warnings?: string[];
  generatedAt: string;
};

const SYSTEM_PROMPT = `You are an expert Python and UX engineer. You analyze Python scripts that have been converted into web forms by an automatic parser, and you produce a much richer, user-friendly schema describing each input.

You MUST respond with ONLY a valid JSON object matching this TypeScript shape (no prose, no markdown fences):
{
  "scriptTitle": string,           // short human-friendly title (max 60 chars)
  "scriptSummary": string,         // 1-2 sentence plain-English description of what the script does
  "fields": [                      // array, one entry per Tkinter form field (match by exact "label")
    {
      "label": string,             // EXACT label from the input schema, do not change
      "friendlyLabel": string,     // cleaner human-friendly label (no emojis, no colons)
      "description": string,       // what to enter and why (1 sentence)
      "placeholder": string,       // suggested placeholder text
      "validation": string,        // plain-English rule (e.g. "Must be a valid email")
      "example": string            // a realistic example value
    }
  ],
  "args": [                        // same shape as "fields", for argparse arguments
    { "label": string, "friendlyLabel": string, "description": string, "placeholder": string, "validation": string, "example": string }
  ],
  "actions": [                     // one entry per Tkinter button (match by exact "label")
    {
      "label": string,             // EXACT label from input schema
      "friendlyLabel": string,     // cleaner button label
      "description": string        // what this action does in plain English
    }
  ],
  "warnings": string[]             // important things end users should know (security, side effects, network calls, deletes, etc.) — at most 3 short bullets
}

Rules:
- Always echo back the EXACT "label" so the frontend can match.
- Never invent fields/actions that are not in the input schema.
- Keep all friendlyLabel/description text under 120 chars.
- Use plain English, end-user friendly tone (assume non-technical users).
- Mention destructive operations (rm, delete, drop, shutdown, reboot) in warnings.`;

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

    const parsed = parseScriptInputs(script.code);

    const summary = {
      args: parsed.args.map((a) => ({ label: a.label, type: a.type, help: a.help, required: a.required })),
      tkFields: parsed.tkForm?.fields.map((f) => ({ label: f.label, kind: f.kind })) ?? [],
      tkActions: parsed.tkForm?.actions.map((a) => ({ label: a.label })) ?? [],
      hasFile: !!parsed.file || !!parsed.tkForm?.needsFile,
    };

    const trimmedCode = script.code.length > 12000
      ? script.code.slice(0, 12000) + "\n# ...[truncated]"
      : script.code;

    const userPrompt = `Script name: ${script.name}
Existing description: ${script.description ?? "(none)"}

Parsed input schema (the auto-generated form):
${JSON.stringify(summary, null, 2)}

Python source code:
\`\`\`python
${trimmedCode}
\`\`\`

Respond with ONLY the JSON object described in the system prompt.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";

    let parsedSchema: AiEnhancedSchema | null = null;
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

    parsedSchema.generatedAt = new Date().toISOString();

    await db.update(scriptsTable)
      .set({ aiSchema: parsedSchema, updatedAt: new Date() })
      .where(eq(scriptsTable.id, id));

    await logAudit({
      req, userId, userEmail: me.email,
      action: "script.ai_enhance",
      resourceType: "script",
      resourceId: id,
      details: { scriptName: script.name, fields: parsedSchema.fields?.length ?? 0, actions: parsedSchema.actions?.length ?? 0 },
    });

    res.json({ aiSchema: parsedSchema });
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
