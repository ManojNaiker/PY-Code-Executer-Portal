import { Router } from "express";
import { db } from "@workspace/db";
import { departmentsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { CreateDepartmentBody } from "@workspace/api-zod";

const router = Router();

async function getUserProfile(clerkId: string) {
  return db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkId) });
}

router.get("/departments", requireAuth, async (req, res) => {
  try {
    const departments = await db.select().from(departmentsTable).orderBy(departmentsTable.name);
    res.json(departments.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Error listing departments");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/departments", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await getUserProfile(userId);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const [dept] = await db.insert(departmentsTable).values(parsed.data).returning();
    await logAudit({ req, userId, userEmail: user.email, action: "department.create", resourceType: "department", resourceId: dept.id, details: { name: dept.name } });
    res.status(201).json({ ...dept, createdAt: dept.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Error creating department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/departments/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const dept = await db.query.departmentsTable.findFirst({ where: eq(departmentsTable.id, id) });
    if (!dept) return res.status(404).json({ error: "Not found" });
    res.json({ ...dept, createdAt: dept.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Error getting department");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/departments/bulk", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await getUserProfile(userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const items: Array<{ name: string; description?: string | null }> = Array.isArray(req.body?.departments) ? req.body.departments : [];
  if (items.length === 0) return res.status(400).json({ error: "Provide a non-empty 'departments' array" });
  if (items.length > 200) return res.status(400).json({ error: "Maximum 200 departments per request" });

  const existing = await db.select().from(departmentsTable);
  const seen = new Set(existing.map(d => d.name.toLowerCase().trim()));

  const created: typeof existing = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const it of items) {
    const name = String(it.name || "").trim();
    if (!name) { failed.push({ name: it.name ?? "", error: "Name required" }); continue; }
    if (seen.has(name.toLowerCase())) { failed.push({ name, error: "Already exists" }); continue; }
    try {
      const [dept] = await db.insert(departmentsTable).values({
        name,
        description: it.description ?? null,
      }).returning();
      created.push(dept);
      seen.add(name.toLowerCase());
    } catch (e: any) {
      failed.push({ name, error: e?.message || "Insert failed" });
    }
  }

  await logAudit({ req, userId, userEmail: user.email, action: "department.bulk_create", resourceType: "department", resourceId: "bulk", details: { created: created.length, failed: failed.length } });
  res.status(201).json({
    created: created.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })),
    failed,
  });
});

router.delete("/departments/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await getUserProfile(userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
    await logAudit({ req, userId, userEmail: user.email, action: "department.delete", resourceType: "department", resourceId: id });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting department");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
