import nodemailer, { type Transporter } from "nodemailer";
import { db, smtpSettingsTable } from "@workspace/db";
import { logger } from "./logger";

export type EmailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export async function getSmtpSettings() {
  const rows = await db.select().from(smtpSettingsTable).limit(1);
  return rows[0] ?? null;
}

export async function buildTransporter(overrides?: {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
}): Promise<{ transporter: Transporter; fromEmail: string; fromName: string | null } | null> {
  let host: string, port: number, secure: boolean, username: string | null, password: string | null, fromEmail: string, fromName: string | null;
  if (overrides) {
    const settings = await getSmtpSettings();
    host = overrides.host;
    port = overrides.port;
    secure = overrides.secure;
    username = overrides.username ?? null;
    password = overrides.password ?? null;
    fromEmail = settings?.fromEmail || overrides.username || "no-reply@localhost";
    fromName = settings?.fromName ?? null;
  } else {
    const settings = await getSmtpSettings();
    if (!settings || !settings.enabled) return null;
    host = settings.host;
    port = settings.port;
    secure = settings.secure;
    username = settings.username;
    password = settings.password;
    fromEmail = settings.fromEmail;
    fromName = settings.fromName;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: username ? { user: username, pass: password ?? "" } : undefined,
  });
  return { transporter, fromEmail, fromName };
}

export async function sendEmail(opts: EmailOptions): Promise<{ ok: boolean; error?: string }> {
  try {
    const built = await buildTransporter();
    if (!built) {
      logger.info("Email not sent — SMTP not configured or disabled");
      return { ok: false, error: "SMTP not configured" };
    }
    const from = built.fromName ? `"${built.fromName}" <${built.fromEmail}>` : built.fromEmail;
    await built.transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (err: any) {
    logger.error({ err }, "Failed to send email");
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function testSmtp(input: {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
  to: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const built = await buildTransporter({
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      password: input.password,
    });
    if (!built) return { ok: false, error: "Could not build transporter" };
    const from = built.fromName ? `"${built.fromName}" <${built.fromEmail}>` : built.fromEmail;
    await built.transporter.sendMail({
      from,
      to: input.to,
      subject: "PyExec Portal — SMTP Test",
      text: "This is a test email from PyExec Portal SMTP settings.",
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
