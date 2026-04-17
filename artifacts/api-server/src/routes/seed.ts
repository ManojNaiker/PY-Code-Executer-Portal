import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createClerkClient } from "@clerk/backend";
import { logger } from "../lib/logger";

const router = Router();

const ADMIN_EMAIL = "admin@pyexec.com";
const ADMIN_PASSWORD = "PyExec@Admin#2024!";
const ADMIN_FIRST_NAME = "System";
const ADMIN_LAST_NAME = "Admin";

export async function seedAdminUser() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.warn("CLERK_SECRET_KEY not set, skipping admin seed");
    return;
  }

  try {
    const clerkClient = createClerkClient({ secretKey });

    // Check if already exists in our DB
    const existing = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, ADMIN_EMAIL),
    });

    if (existing) {
      logger.info("Admin user already exists, skipping seed");
      return;
    }

    // Check if exists in Clerk
    let clerkUserId: string | null = null;
    try {
      const { data: users } = await clerkClient.users.getUserList({
        emailAddress: [ADMIN_EMAIL],
      });

      if (users.length > 0) {
        clerkUserId = users[0].id;
        logger.info({ clerkUserId }, "Admin user exists in Clerk, syncing to DB");
      }
    } catch (err) {
      logger.warn({ err }, "Error checking Clerk for admin user");
    }

    // Create in Clerk if not exists
    if (!clerkUserId) {
      try {
        const clerkUser = await clerkClient.users.createUser({
          emailAddress: [ADMIN_EMAIL],
          password: ADMIN_PASSWORD,
          firstName: ADMIN_FIRST_NAME,
          lastName: ADMIN_LAST_NAME,
          skipPasswordChecks: true,
        });
        clerkUserId = clerkUser.id;
        logger.info({ clerkUserId }, "Admin user created in Clerk");
      } catch (err: any) {
        logger.error({ err: err?.message }, "Failed to create admin user in Clerk");
        return;
      }
    }

    // Create in our DB as admin
    await db.insert(usersTable).values({
      clerkId: clerkUserId,
      email: ADMIN_EMAIL,
      firstName: ADMIN_FIRST_NAME,
      lastName: ADMIN_LAST_NAME,
      role: "admin",
    }).onConflictDoUpdate({
      target: usersTable.clerkId,
      set: { role: "admin", email: ADMIN_EMAIL },
    });

    logger.info("Admin user seeded successfully");
  } catch (err) {
    logger.error({ err }, "Error seeding admin user");
  }
}

export default router;
