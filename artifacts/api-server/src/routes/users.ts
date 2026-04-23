import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, departmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { generateUserId } from "../lib/sessionAuth";
import { sendEmail } from "../lib/email";
import { AssignUserDepartmentBody, AssignUserRoleBody, UpdateMyProfileBody } from "@workspace/api-zod";

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

async function getUserWithDept(clerkId: string) {
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkId) });
  if (!user) return null;
  let departmentName: string | null = null;
  if (user.departmentId) {
    const dept = await db.query.departmentsTable.findFirst({ where: eq(departmentsTable.id, user.departmentId) });
    departmentName = dept?.name ?? null;
  }
  return { ...user, departmentName, createdAt: user.createdAt.toISOString() };
}

async function ensureUserExists(clerkId: string, email: string, firstName?: string | null, lastName?: string | null) {
  const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkId) });
  if (existing) return existing;
  const allUsers = await db.select().from(usersTable);
  const role = allUsers.length === 0 ? "admin" : "user";
  const [user] = await db.insert(usersTable).values({ clerkId, email, firstName: firstName ?? null, lastName: lastName ?? null, role }).returning();
  return user;
}

router.get("/users/me", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    let user = await getUserWithDept(userId);
    if (!user) {
      await ensureUserExists(userId, "unknown@example.com");
      user = await getUserWithDept(userId);
    }
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error getting user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/users/me", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    await db.update(usersTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(usersTable.clerkId, userId));
    const user = await getUserWithDept(userId);
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error updating user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
  if (!me || me.role !== "admin") return res.status(403).json({ error: "Admin only" });

  try {
    const users = await db.select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
      createdAt: usersTable.createdAt,
    }).from(usersTable)
      .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
      .orderBy(usersTable.createdAt);

    res.json(users.map(u => ({ ...u, departmentName: u.departmentName ?? null, createdAt: u.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Error listing users");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/users/:clerkId/department", requireAuth, async (req, res) => {
  const adminId = (req as any).userId as string;
  const admin = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, adminId) });
  if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const parsed = AssignUserDepartmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    await db.update(usersTable)
      .set({ departmentId: parsed.data.departmentId, updatedAt: new Date() })
      .where(eq(usersTable.clerkId, req.params.clerkId));
    const user = await getUserWithDept(req.params.clerkId);
    await logAudit({ req, userId: adminId, userEmail: admin.email, action: "user.assign_department", resourceType: "user", resourceId: req.params.clerkId, details: { departmentId: parsed.data.departmentId } });
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error assigning department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/users/:clerkId/role", requireAuth, async (req, res) => {
  const adminId = (req as any).userId as string;
  const admin = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, adminId) });
  if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const parsed = AssignUserRoleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    await db.update(usersTable)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(eq(usersTable.clerkId, req.params.clerkId));
    const user = await getUserWithDept(req.params.clerkId);
    await logAudit({ req, userId: adminId, userEmail: admin.email, action: "user.assign_role", resourceType: "user", resourceId: req.params.clerkId, details: { role: parsed.data.role } });
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error assigning role");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Admin: create users (single + bulk) and delete users.
// ---------------------------------------------------------------------------

type NewUserInput = {
  email: string;
  password?: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: "admin" | "user";
  departmentId?: number | null;
};

async function createOneUser(input: NewUserInput) {
  const email = String(input.email || "").toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: "Invalid email", email };
  }
  const password = String(input.password || "").trim() || "changeme123";
  if (password.length < 6) return { ok: false as const, error: "Password too short", email };

  const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
  if (existing) return { ok: false as const, error: "User already exists", email };

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    clerkId: generateUserId(),
    email,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    role: input.role === "admin" ? "admin" : "user",
    departmentId: input.departmentId ?? null,
    passwordHash,
  }).returning();
  return { ok: true as const, user, plainPassword: password };
}

async function sendNewUserNotification(user: { email: string; firstName: string | null; lastName: string | null; role: string }, plainPassword: string) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const subject = "Your PyExec Portal account has been created";
  const text = [
    `Hello ${fullName},`,
    "",
    "An account has been created for you on PyExec Portal.",
    "",
    `Email:    ${user.email}`,
    `Password: ${plainPassword}`,
    `Role:     ${user.role}`,
    "",
    "Please sign in and change your password as soon as possible.",
    "",
    "— PyExec Portal",
  ].join("\n");
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f1e3c;">
      <h2 style="color:#1d3573;">Welcome to PyExec Portal</h2>
      <p>Hello ${fullName},</p>
      <p>An account has been created for you. You can sign in with the credentials below:</p>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 12px;color:#555;">Email</td><td style="padding:4px 12px;font-family:monospace;">${user.email}</td></tr>
        <tr><td style="padding:4px 12px;color:#555;">Password</td><td style="padding:4px 12px;font-family:monospace;">${plainPassword}</td></tr>
        <tr><td style="padding:4px 12px;color:#555;">Role</td><td style="padding:4px 12px;">${user.role}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;">Please sign in and change your password as soon as possible.</p>
    </div>`;
  const result = await sendEmail({ to: user.email, subject, text, html });
  return result;
}

router.post("/users", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const result = await createOneUser(req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    await logAudit({ req, userId: admin.clerkId, userEmail: admin.email, action: "user.create", resourceType: "user", resourceId: result.user.clerkId, details: { email: result.user.email, role: result.user.role } });
    const emailResult = await sendNewUserNotification(result.user, result.plainPassword);
    if (!emailResult.ok) req.log.warn({ email: result.user.email, error: emailResult.error }, "User created but notification email not sent");
    res.status(201).json({ ...(await getUserWithDept(result.user.clerkId)), notificationSent: emailResult.ok, notificationError: emailResult.ok ? undefined : emailResult.error });
  } catch (err) {
    req.log.error({ err }, "Error creating user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users/bulk", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const items: NewUserInput[] = Array.isArray(req.body?.users) ? req.body.users : [];
  if (items.length === 0) return res.status(400).json({ error: "Provide a non-empty 'users' array" });
  if (items.length > 500) return res.status(400).json({ error: "Maximum 500 users per request" });

  // Resolve department names → ids if departmentName provided.
  const allDepts = await db.select().from(departmentsTable);
  const deptByName = new Map<string, number>();
  for (const d of allDepts) deptByName.set(d.name.toLowerCase().trim(), d.id);

  const created: Array<{ email: string; clerkId: string; tempPassword?: string }> = [];
  const failed: Array<{ email: string; error: string }> = [];
  for (const raw of items) {
    const item: any = { ...raw };
    if (typeof item.departmentName === "string" && !item.departmentId) {
      item.departmentId = deptByName.get(item.departmentName.toLowerCase().trim()) ?? null;
    }
    const tempPassword = item.password && String(item.password).length >= 6 ? undefined : "changeme123";
    const r = await createOneUser(item);
    if (r.ok) {
      created.push({ email: r.user.email, clerkId: r.user.clerkId, ...(tempPassword ? { tempPassword } : {}) });
      sendNewUserNotification(r.user, r.plainPassword).catch(() => {});
    }
    else failed.push({ email: r.email, error: r.error });
  }

  await logAudit({ req, userId: admin.clerkId, userEmail: admin.email, action: "user.bulk_create", resourceType: "user", resourceId: "bulk", details: { created: created.length, failed: failed.length } });
  res.status(201).json({ created, failed });
});

router.delete("/users/:clerkId", requireAuth, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const target = req.params.clerkId;
  if (target === admin.clerkId) return res.status(400).json({ error: "Cannot delete yourself" });
  try {
    const target_user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, target) });
    if (!target_user) return res.status(404).json({ error: "User not found" });
    await db.delete(usersTable).where(eq(usersTable.clerkId, target));
    await logAudit({ req, userId: admin.clerkId, userEmail: admin.email, action: "user.delete", resourceType: "user", resourceId: target, details: { email: target_user.email } });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { ensureUserExists };
export default router;
