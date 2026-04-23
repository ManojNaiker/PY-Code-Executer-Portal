import { Router } from "express";
import { db, smtpSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { testSmtp } from "../lib/email";

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

  // If form fields not given, fall back to stored settings
  if (!host || !Number.isFinite(port)) {
    const existing = (await db.select().from(smtpSettingsTable).limit(1))[0];
    if (!existing) return res.status(400).json({ error: "No SMTP settings configured. Save settings first or provide host/port." });
    host = existing.host;
    port = existing.port;
    secure = existing.secure;
    username = existing.username;
    if (!password) password = existing.password;
  }

  const result = await testSmtp({ host, port, secure, username, password, to });
  if (!result.ok) return res.status(400).json({ error: result.error || "Failed to send test email" });
  res.json({ ok: true });
});

export default router;
