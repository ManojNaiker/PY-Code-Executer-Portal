import jwt from "jsonwebtoken";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";

const COOKIE_NAME = "pyexec_session";
const SESSION_TTL_DAYS = 30;

function loadSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = path.join(os.homedir(), ".pyexec-session-secret");
  try {
    if (fs.existsSync(secretPath)) {
      const v = fs.readFileSync(secretPath, "utf-8").trim();
      if (v) return v;
    }
  } catch {}
  const generated = crypto.randomBytes(48).toString("hex");
  try {
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch {}
  return generated;
}

const SECRET = loadSecret();

export type SessionPayload = { uid: string; email: string };

export function generateUserId(): string {
  return `usr_${crypto.randomBytes(12).toString("hex")}`;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: `${SESSION_TTL_DAYS}d` });
}

export function setSessionCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSession(req: Request): SessionPayload | null {
  const token = (req as any).cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, SECRET) as SessionPayload;
    return decoded;
  } catch {
    return null;
  }
}

export const sessionMiddleware: RequestHandler = (req, _res, next) => {
  const session = readSession(req);
  if (session) {
    (req as any).userId = session.uid;
    (req as any).userEmail = session.email;
  }
  next();
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
