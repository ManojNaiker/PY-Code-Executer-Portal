import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable, scriptsTable, departmentsTable, executionsTable } from "@workspace/db";
import { eq, desc, sql, count, and, gte } from "drizzle-orm";

import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/audit-logs", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const page = Math.max(1, parseInt(String(req.query.page || 1)));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || 50))));
  const offset = (page - 1) * limit;
  const action = req.query.action ? String(req.query.action) : undefined;
  // Non-admins can only see their own logs; admins may filter by any userId
  const filterUserId = me.role === "admin"
    ? (req.query.userId ? String(req.query.userId) : undefined)
    : userId;

  try {
    const conditions: any[] = [];
    if (action) conditions.push(eq(auditLogsTable.action, action));
    if (filterUserId) conditions.push(eq(auditLogsTable.userId, filterUserId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes] = await db.select({ count: count() }).from(auditLogsTable).where(whereClause);
    const logs = await db.select().from(auditLogsTable)
      .where(whereClause)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      logs: logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
      total: totalRes.count,
      page,
      limit,
    });
  } catch (err) {
    req.log.error({ err }, "Error listing audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/stats", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const me = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    if (!me) return res.status(401).json({ error: "Unauthorized" });

    const [[{ totalScripts }], [{ totalUsers }], [{ totalDepartments }], [{ totalExecutions }]] = await Promise.all([
      db.select({ totalScripts: count() }).from(scriptsTable),
      db.select({ totalUsers: count() }).from(usersTable),
      db.select({ totalDepartments: count() }).from(departmentsTable),
      db.select({ totalExecutions: count() }).from(executionsTable),
    ]);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ recentExecutions }] = await db.select({ recentExecutions: count() })
      .from(executionsTable)
      .where(gte(executionsTable.createdAt, oneDayAgo));

    const scriptsByDept = await db.select({
      departmentName: sql<string>`COALESCE(${departmentsTable.name}, 'Unassigned')`,
      count: count(),
    }).from(scriptsTable)
      .leftJoin(departmentsTable, eq(scriptsTable.departmentId, departmentsTable.id))
      .groupBy(departmentsTable.name);

    const recentActivity = await db.select().from(auditLogsTable)
      .where(me.role === "admin" ? undefined : eq(auditLogsTable.userId, userId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(10);

    res.json({
      totalScripts,
      totalUsers,
      totalDepartments,
      totalExecutions,
      recentExecutions,
      scriptsByDepartment: scriptsByDept.map(r => ({ departmentName: r.departmentName, count: r.count })),
      recentActivity: recentActivity.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting dashboard stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
