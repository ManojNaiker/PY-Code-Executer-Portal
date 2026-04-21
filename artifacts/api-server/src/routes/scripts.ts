import { Router } from "express";
import { db } from "@workspace/db";
import { scriptsTable, usersTable, departmentsTable } from "@workspace/db";
import { eq, and, isNull, or } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";
import { UploadScriptBody } from "@workspace/api-zod";

const router = Router();

function mapScript(script: any, deptName?: string | null, uploaderName?: string | null) {
  return {
    id: script.id,
    name: script.name,
    description: script.description ?? null,
    filename: script.filename,
    code: script.code,
    departmentId: script.departmentId ?? null,
    departmentName: deptName ?? null,
    uploadedBy: script.uploadedBy,
    uploadedByName: uploaderName ?? null,
    createdAt: script.createdAt instanceof Date ? script.createdAt.toISOString() : script.createdAt,
    updatedAt: script.updatedAt instanceof Date ? script.updatedAt.toISOString() : script.updatedAt,
  };
}

router.get("/scripts", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const rows = await db.select({
      script: scriptsTable,
      departmentName: departmentsTable.name,
      uploaderFirstName: usersTable.firstName,
      uploaderLastName: usersTable.lastName,
    }).from(scriptsTable)
      .leftJoin(departmentsTable, eq(scriptsTable.departmentId, departmentsTable.id))
      .leftJoin(usersTable, eq(scriptsTable.uploadedBy, usersTable.clerkId))
      .orderBy(scriptsTable.createdAt);

    const filtered = me.role === "admin"
      ? rows
      : rows.filter(r =>
          r.script.departmentId === null || r.script.departmentId === me.departmentId
        );

    res.json(filtered.map(r => mapScript(
      r.script,
      r.departmentName,
      r.uploaderFirstName ? `${r.uploaderFirstName} ${r.uploaderLastName || ""}`.trim() : null
    )));
  } catch (err) {
    req.log.error({ err }, "Error listing scripts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/scripts", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  const parsed = UploadScriptBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const [script] = await db.insert(scriptsTable).values({
      ...parsed.data,
      uploadedBy: userId,
      departmentId: parsed.data.departmentId ?? null,
    }).returning();

    await logAudit({
      req, userId, userEmail: me.email,
      action: "script.upload", resourceType: "script", resourceId: script.id,
      details: { name: script.name, filename: script.filename, departmentId: script.departmentId },
    });

    res.status(201).json(mapScript(script));
  } catch (err) {
    req.log.error({ err }, "Error uploading script");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/scripts/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const [row] = await db.select({
      script: scriptsTable,
      departmentName: departmentsTable.name,
      uploaderFirstName: usersTable.firstName,
      uploaderLastName: usersTable.lastName,
    }).from(scriptsTable)
      .leftJoin(departmentsTable, eq(scriptsTable.departmentId, departmentsTable.id))
      .leftJoin(usersTable, eq(scriptsTable.uploadedBy, usersTable.clerkId))
      .where(eq(scriptsTable.id, id));

    if (!row) return res.status(404).json({ error: "Not found" });

    if (me.role !== "admin" && row.script.departmentId !== null && row.script.departmentId !== me.departmentId) {
      await logAudit({ req, userId, userEmail: me.email, action: "script.access_denied", resourceType: "script", resourceId: id });
      return res.status(403).json({ error: "Access denied" });
    }

    await logAudit({ req, userId, userEmail: me.email, action: "script.view", resourceType: "script", resourceId: id });
    res.json(mapScript(
      row.script, row.departmentName,
      row.uploaderFirstName ? `${row.uploaderFirstName} ${row.uploaderLastName || ""}`.trim() : null
    ));
  } catch (err) {
    req.log.error({ err }, "Error getting script");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/scripts/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "User not found" });

    const script = await db.query.scriptsTable.findFirst({ where: eq(scriptsTable.id, id) });
    if (!script) return res.status(404).json({ error: "Not found" });

    if (me.role !== "admin" && script.uploadedBy !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await db.delete(scriptsTable).where(eq(scriptsTable.id, id));
    await logAudit({ req, userId, userEmail: me.email, action: "script.delete", resourceType: "script", resourceId: id });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting script");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
