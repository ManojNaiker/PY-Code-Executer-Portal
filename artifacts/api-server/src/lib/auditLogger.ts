import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import type { Request } from "express";

export async function logAudit(params: {
  req?: Request;
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string | number;
  details?: Record<string, unknown>;
}) {
  try {
    const ipAddress = params.req
      ? (params.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        params.req.socket?.remoteAddress ||
        null
      : null;

    await db.insert(auditLogsTable).values({
      userId: params.userId ?? null,
      userEmail: params.userEmail ?? null,
      action: params.action,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ? String(params.resourceId) : null,
      details: params.details ?? null,
      ipAddress,
    });
  } catch (err) {
    // Don't crash on audit log failures
  }
}
