import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, departmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { AssignUserDepartmentBody, AssignUserRoleBody, UpdateMyProfileBody } from "@workspace/api-zod";

const router = Router();

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

export { ensureUserExists };
export default router;
