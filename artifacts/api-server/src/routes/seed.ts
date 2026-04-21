import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { logger } from "../lib/logger";
import { generateUserId } from "../lib/sessionAuth";

const router = Router();

const ADMIN_EMAIL = "admin@pyexec.com";
const ADMIN_PASSWORD = "admin@123";
const ADMIN_FIRST_NAME = "System";
const ADMIN_LAST_NAME = "Admin";

export async function seedAdminUser() {
  try {
    const existing = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, ADMIN_EMAIL),
    });

    if (existing) {
      if (!existing.passwordHash) {
        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await db.update(usersTable)
          .set({ passwordHash })
          .where(eq(usersTable.email, ADMIN_EMAIL));
        logger.info("Admin password hash updated");
      }
      logger.info("Admin user already exists, skipping seed");
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.insert(usersTable).values({
      clerkId: generateUserId(),
      email: ADMIN_EMAIL,
      firstName: ADMIN_FIRST_NAME,
      lastName: ADMIN_LAST_NAME,
      role: "admin",
      passwordHash,
    });

    logger.info({ email: ADMIN_EMAIL }, "Admin user seeded — login with admin@pyexec.com / admin@123");
  } catch (err) {
    logger.error({ err }, "Error seeding admin user");
  }
}

export default router;
