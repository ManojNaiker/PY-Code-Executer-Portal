import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, signSession, setSessionCookie, clearSessionCookie, generateUserId } from "../lib/sessionAuth";
import { logAudit } from "../lib/auditLogger";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, String(email).toLowerCase().trim()),
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signSession({ uid: user.clerkId, email: user.email });
    setSessionCookie(res, token);

    await logAudit({ req, userId: user.clerkId, userEmail: user.email, action: "user.login", resourceType: "user", resourceId: user.clerkId });

    res.json({
      id: user.id,
      userId: user.clerkId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      departmentId: user.departmentId,
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/register", async (req, res) => {
  const { email, password, firstName, lastName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  try {
    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, normalizedEmail) });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const allUsers = await db.select().from(usersTable);
    const role = allUsers.length === 0 ? "admin" : "user";
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateUserId();

    const [user] = await db.insert(usersTable).values({
      clerkId: userId,
      email: normalizedEmail,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      role,
      passwordHash,
    }).returning();

    const token = signSession({ uid: user.clerkId, email: user.email });
    setSessionCookie(res, token);

    await logAudit({ req, userId: user.clerkId, userEmail: user.email, action: "user.register", resourceType: "user", resourceId: user.clerkId });

    res.status(201).json({
      id: user.id,
      userId: user.clerkId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      departmentId: user.departmentId,
    });
  } catch (err) {
    req.log.error({ err }, "Register error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", async (req, res) => {
  const userId = (req as any).userId;
  const userEmail = (req as any).userEmail;
  clearSessionCookie(res);
  if (userId) {
    await logAudit({ req, userId, userEmail: userEmail ?? "", action: "user.logout", resourceType: "user", resourceId: userId });
  }
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({
      id: user.id,
      userId: user.clerkId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      departmentId: user.departmentId,
    });
  } catch (err) {
    req.log.error({ err }, "Auth me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
