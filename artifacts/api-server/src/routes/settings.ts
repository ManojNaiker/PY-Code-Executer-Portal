import { Router } from "express";
import { db, smtpSettingsTable, aiSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { testSmtp } from "../lib/email";
import { hasReplitAnthropicEnv } from "../lib/aiClient";

const router = Router();

async function requireAdmin(req: any, res: any) {
  const adminId = req.userId as string;
  const admin = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, adminId) });
  if (!admin || admin.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return null;
  }
  return admin;
}

function sanitize(row: any) {
  if (!row) return null;
  const { password, ...rest } = row;
  return { ...rest, hasPassword: Boolean(password), updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt };
}

router.get("/settings/smtp", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const rows = await db.select().from(smtpSettingsTable).limit(1);
    res.json(sanitize(rows[0]));
  } catch (err) {
    req.log.error({ err }, "Error reading SMTP settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings/smtp", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = req.body || {};
  const host = String(body.host || "").trim();
  const portNum = Number(body.port);
  const fromEmail = String(body.fromEmail || "").trim();
  if (!host) return res.status(400).json({ error: "host is required" });
  if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) return res.status(400).json({ error: "port must be between 1 and 65535" });
  if (!fromEmail) return res.status(400).json({ error: "fromEmail is required" });

  const username = body.username ? String(body.username) : null;
  const fromName = body.fromName ? String(body.fromName) : null;
  const secure = Boolean(body.secure);
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

  try {
    const existing = (await db.select().from(smtpSettingsTable).limit(1))[0];
    let row;
    if (existing) {
      const updates: any = { host, port: portNum, secure, username, fromEmail, fromName, enabled, updatedAt: new Date() };
      if (typeof body.password === "string" && body.password.length > 0) updates.password = body.password;
      [row] = await db.update(smtpSettingsTable).set(updates).where(eq(smtpSettingsTable.id, existing.id)).returning();
    } else {
      const password = typeof body.password === "string" ? body.password : null;
      [row] = await db.insert(smtpSettingsTable).values({ host, port: portNum, secure, username, password, fromEmail, fromName, enabled }).returning();
    }
    await logAudit({ req, userId: admin.clerkId, userEmail: admin.email, action: "settings.smtp_update", resourceType: "settings", resourceId: "smtp", details: { host, port: portNum, fromEmail, enabled } });
    res.json(sanitize(row));
  } catch (err) {
    req.log.error({ err }, "Error saving SMTP settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/smtp/test", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = req.body || {};
  const to = String(body.to || admin.email || "").trim();
  if (!to) return res.status(400).json({ error: "Recipient 'to' is required" });

  let host = String(body.host || "").trim();
  let port = Number(body.port);
  let secure = Boolean(body.secure);
  let username: string | null = body.username ? String(body.username) : null;
  let password: string | null = typeof body.password === "string" && body.password.length > 0 ? body.password : null;

  const existing = (await db.select().from(smtpSettingsTable).limit(1))[0];

  // If form fields not given, fall back to stored settings
  if (!host || !Number.isFinite(port)) {
    if (!existing) return res.status(400).json({ error: "No SMTP settings configured. Save settings first or provide host/port." });
    host = existing.host;
    port = existing.port;
    secure = existing.secure;
    username = existing.username;
    if (!password) password = existing.password;
  }

  // If password is blank but a saved one exists for the same username, use it
  if (!password && existing && existing.password && (username ?? "") === (existing.username ?? "")) {
    password = existing.password;
  }

  const result = await testSmtp({ host, port, secure, username, password, to });
  if (!result.ok) return res.status(400).json({ error: result.error || "Failed to send test email" });
  res.json({ ok: true });
});

// ===================== AI provider settings =====================

const ALLOWED_PROVIDERS = new Set(["anthropic", "openai", "grok"]);
const REPLIT_DEFAULT_PROVIDER = "anthropic";

function sanitizeAi(row: any) {
  if (!row) return null;
  const { apiKey, ...rest } = row;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey && String(apiKey).length > 0),
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

router.get("/settings/ai", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const rows = await db.select().from(aiSettingsTable).limit(1);
    const row = rows[0] ?? null;
    res.json({
      settings: sanitizeAi(row),
      replitDefault: {
        // While running on Replit, the Anthropic integration provides a key
        // automatically. Frontend uses this to hint that no key is required.
        provider: REPLIT_DEFAULT_PROVIDER,
        available: hasReplitAnthropicEnv(),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error reading AI settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings/ai", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = req.body || {};
  const provider = String(body.provider || "").trim().toLowerCase();
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return res.status(400).json({ error: "provider must be one of: anthropic, openai, grok" });
  }
  const baseUrl = body.baseUrl ? String(body.baseUrl).trim() || null : null;
  const model = body.model ? String(body.model).trim() || null : null;

  try {
    const existing = (await db.select().from(aiSettingsTable).limit(1))[0];
    let row;
    if (existing) {
      const updates: any = { provider, baseUrl, model, updatedAt: new Date() };
      // Only overwrite the API key when a new value (or explicit clear) was sent.
      if (typeof body.apiKey === "string") {
        updates.apiKey = body.apiKey.length > 0 ? body.apiKey : null;
      }
      [row] = await db.update(aiSettingsTable).set(updates).where(eq(aiSettingsTable.id, existing.id)).returning();
    } else {
      const apiKey = typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : null;
      [row] = await db.insert(aiSettingsTable).values({ provider, apiKey, baseUrl, model }).returning();
    }

    await logAudit({
      req,
      userId: admin.clerkId,
      userEmail: admin.email,
      action: "settings.ai_update",
      resourceType: "settings",
      resourceId: "ai",
      details: { provider, model, hasKey: Boolean(row?.apiKey) },
    });

    res.json({
      settings: sanitizeAi(row),
      replitDefault: { provider: REPLIT_DEFAULT_PROVIDER, available: hasReplitAnthropicEnv() },
    });
  } catch (err) {
    req.log.error({ err }, "Error saving AI settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
