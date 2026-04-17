import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAuth } from "../middlewares/requireAuth";
import { logAudit } from "../lib/auditLogger";

const router = Router();

router.post("/auth/sync", requireAuth, async (req, res) => {
  const auth = getAuth(req);
  const userId = auth.userId!;
  const { email, firstName, lastName } = req.body;

  try {
    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    const allUsers = await db.select().from(usersTable);
    const role = allUsers.length === 0 || (allUsers.length === 1 && existing) ? (existing?.role ?? "admin") : (existing?.role ?? "user");

    if (existing) {
      await db.update(usersTable)
        .set({ email: email || existing.email, firstName: firstName ?? existing.firstName, lastName: lastName ?? existing.lastName, updatedAt: new Date() })
        .where(eq(usersTable.clerkId, userId));
      if (!existing.createdAt) {
        await logAudit({ req, userId, userEmail: email, action: "user.login", resourceType: "user", resourceId: userId });
      }
    } else {
      const firstUser = allUsers.length === 0;
      await db.insert(usersTable).values({
        clerkId: userId,
        email: email || "unknown@example.com",
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        role: firstUser ? "admin" : "user",
      });
      await logAudit({ req, userId, userEmail: email, action: "user.register", resourceType: "user", resourceId: userId });
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, userId) });
    res.json({ ...user, createdAt: user?.createdAt?.toISOString(), updatedAt: user?.updatedAt?.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Error syncing user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
