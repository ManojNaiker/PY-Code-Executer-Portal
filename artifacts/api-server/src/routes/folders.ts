import { Router } from "express";
import { db } from "@workspace/db";
import { scriptFoldersTable, scriptsTable, usersTable } from "@workspace/db";
import { eq, inArray, ne, sql } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";

const router = Router();

const ALLOWED_ICONS = new Set([
  "Folder", "FolderOpen", "Briefcase", "BarChart3", "FileText", "Database",
  "Cog", "BookOpen", "Mail", "Cloud", "Lock", "Star", "Heart", "Zap",
  "Code2", "Server", "Package", "PieChart", "Calendar", "Users", "Box",
  "Layers", "Activity", "Globe",
]);
const ALLOWED_COLORS = new Set([
  "amber", "blue", "green", "purple", "pink", "red", "slate", "teal",
  "orange", "indigo",
]);

async function getProfile(clerkId: string) {
  return db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkId) });
}

router.get("/folders", requireAuth, async (_req, res) => {
  const folders = await db.select().from(scriptFoldersTable).orderBy(scriptFoldersTable.name);
  res.json(folders.map(f => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  })));
});

router.post("/folders", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const me = await getProfile(userId);
  if (!me || me.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name required" });
  const icon = ALLOWED_ICONS.has(req.body?.icon) ? req.body.icon : "Folder";
  const color = ALLOWED_COLORS.has(req.body?.color) ? req.body.color : "amber";
  const description = req.body?.description ? String(req.body.description) : null;

  const exists = await db.query.scriptFoldersTable.findFirst({
    where: eq(scriptFoldersTable.name, name),
  });
  if (exists) return res.status(409).json({ error: "Folder already exists" });

  const [folder] = await db.insert(scriptFoldersTable).values({
    name, icon, color, description, createdBy: userId,
  }).returning();

  await logAudit({ req, userId, userEmail: me.email, action: "folder.create", resourceType: "folder", resourceId: folder.id, details: { name, icon, color } });
  res.status(201).json(folder);
});

router.put("/folders/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const me = await getProfile(userId);
  if (!me || me.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const folder = await db.query.scriptFoldersTable.findFirst({ where: eq(scriptFoldersTable.id, id) });
  if (!folder) return res.status(404).json({ error: "Not found" });

  const updates: any = { updatedAt: new Date() };
  let renamedFrom: string | null = null;
  if (typeof req.body?.name === "string" && req.body.name.trim() && req.body.name.trim() !== folder.name) {
    const newName = req.body.name.trim();
    const conflict = await db.query.scriptFoldersTable.findFirst({ where: eq(scriptFoldersTable.name, newName) });
    if (conflict && conflict.id !== id) return res.status(409).json({ error: "Folder name already in use" });
    updates.name = newName;
    renamedFrom = folder.name;
  }
  if (req.body?.icon && ALLOWED_ICONS.has(req.body.icon)) updates.icon = req.body.icon;
  if (req.body?.color && ALLOWED_COLORS.has(req.body.color)) updates.color = req.body.color;
  if (req.body?.description !== undefined) updates.description = req.body.description ? String(req.body.description) : null;

  const [updated] = await db.update(scriptFoldersTable).set(updates).where(eq(scriptFoldersTable.id, id)).returning();

  // If renamed, also retag scripts whose subject matches old name
  if (renamedFrom) {
    await db.update(scriptsTable).set({ subject: updated.name, updatedAt: new Date() }).where(eq(scriptsTable.subject, renamedFrom));
  }

  await logAudit({ req, userId, userEmail: me.email, action: "folder.update", resourceType: "folder", resourceId: id, details: { renamedFrom, updates: Object.keys(updates) } });
  res.json(updated);
});

router.delete("/folders/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const me = await getProfile(userId);
  if (!me || me.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const folder = await db.query.scriptFoldersTable.findFirst({ where: eq(scriptFoldersTable.id, id) });
  if (!folder) return res.status(404).json({ error: "Not found" });

  // Unassign scripts that reference this folder name
  await db.update(scriptsTable).set({ subject: null, updatedAt: new Date() }).where(eq(scriptsTable.subject, folder.name));
  await db.delete(scriptFoldersTable).where(eq(scriptFoldersTable.id, id));

  await logAudit({ req, userId, userEmail: me.email, action: "folder.delete", resourceType: "folder", resourceId: id, details: { name: folder.name } });
  res.status(204).send();
});

// Assign / unassign scripts to a folder. Body: { scriptIds: number[], action: "add" | "set" }
// - "add": set scripts' subject to folder.name (does not touch others)
// - "set": set the folder's full membership (provided scripts in, all others currently in folder are removed)
router.post("/folders/:id/assign", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const me = await getProfile(userId);
  if (!me || me.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const folder = await db.query.scriptFoldersTable.findFirst({ where: eq(scriptFoldersTable.id, id) });
  if (!folder) return res.status(404).json({ error: "Not found" });

  const scriptIds: number[] = Array.isArray(req.body?.scriptIds)
    ? req.body.scriptIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  const mode: "add" | "set" = req.body?.action === "set" ? "set" : "add";

  if (mode === "set") {
    // Remove from this folder any scripts not in the new list
    if (scriptIds.length === 0) {
      await db.update(scriptsTable).set({ subject: null, updatedAt: new Date() }).where(eq(scriptsTable.subject, folder.name));
    } else {
      await db.update(scriptsTable).set({ subject: null, updatedAt: new Date() })
        .where(sql`${scriptsTable.subject} = ${folder.name} AND ${scriptsTable.id} NOT IN (${sql.join(scriptIds.map(n => sql`${n}`), sql`, `)})`);
    }
  }
  if (scriptIds.length > 0) {
    await db.update(scriptsTable).set({ subject: folder.name, updatedAt: new Date() }).where(inArray(scriptsTable.id, scriptIds));
  }

  await logAudit({ req, userId, userEmail: me.email, action: "folder.assign", resourceType: "folder", resourceId: id, details: { mode, count: scriptIds.length } });
  res.json({ ok: true, count: scriptIds.length });
});

export default router;
