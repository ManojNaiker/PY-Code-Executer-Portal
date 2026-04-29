import { db } from "@workspace/db";
import { scriptDepartmentsTable, departmentsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

export type DeptRef = { id: number; name: string };

/**
 * Returns a map of scriptId -> array of {id, name} departments assigned to that script.
 * Scripts with no rows in the join table are considered "Global" (accessible to anyone).
 */
export async function getScriptDepartments(scriptIds: number[]): Promise<Map<number, DeptRef[]>> {
  const result = new Map<number, DeptRef[]>();
  if (scriptIds.length === 0) return result;

  const rows = await db
    .select({
      scriptId: scriptDepartmentsTable.scriptId,
      departmentId: scriptDepartmentsTable.departmentId,
      departmentName: departmentsTable.name,
    })
    .from(scriptDepartmentsTable)
    .innerJoin(departmentsTable, eq(scriptDepartmentsTable.departmentId, departmentsTable.id))
    .where(inArray(scriptDepartmentsTable.scriptId, scriptIds));

  for (const r of rows) {
    const list = result.get(r.scriptId) ?? [];
    list.push({ id: r.departmentId, name: r.departmentName });
    result.set(r.scriptId, list);
  }
  return result;
}

export async function getScriptDepartmentIds(scriptId: number): Promise<number[]> {
  const rows = await db
    .select({ departmentId: scriptDepartmentsTable.departmentId })
    .from(scriptDepartmentsTable)
    .where(eq(scriptDepartmentsTable.scriptId, scriptId));
  return rows.map(r => r.departmentId);
}

/**
 * Replace the set of departments assigned to a script.
 * Pass an empty array to make the script "Global" (no department restriction).
 */
export async function setScriptDepartments(scriptId: number, departmentIds: number[]): Promise<void> {
  const unique = Array.from(new Set(departmentIds.filter(n => Number.isInteger(n) && n > 0)));
  await db.transaction(async (tx) => {
    await tx.delete(scriptDepartmentsTable).where(eq(scriptDepartmentsTable.scriptId, scriptId));
    if (unique.length > 0) {
      await tx.insert(scriptDepartmentsTable).values(
        unique.map(departmentId => ({ scriptId, departmentId })),
      );
    }
  });
}

/**
 * Access policy:
 *  - admin: always allowed (callers should usually check role first)
 *  - script has no department rows -> "Global", allowed for everyone
 *  - script has department rows -> user's department must be in the set
 */
export async function userCanAccessScript(
  user: { role: string; departmentId: number | null },
  scriptId: number,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const ids = await getScriptDepartmentIds(scriptId);
  if (ids.length === 0) return true;
  if (user.departmentId == null) return false;
  return ids.includes(user.departmentId);
}

/**
 * Return only the script IDs the given user is allowed to access from a candidate list.
 * Useful for filtering list endpoints in one round-trip.
 */
export async function filterAccessibleScriptIds(
  user: { role: string; departmentId: number | null },
  scriptIds: number[],
): Promise<Set<number>> {
  if (user.role === "admin") return new Set(scriptIds);
  if (scriptIds.length === 0) return new Set();
  const map = await getScriptDepartments(scriptIds);
  const allowed = new Set<number>();
  for (const id of scriptIds) {
    const depts = map.get(id);
    if (!depts || depts.length === 0) {
      allowed.add(id);
    } else if (user.departmentId != null && depts.some(d => d.id === user.departmentId)) {
      allowed.add(id);
    }
  }
  return allowed;
}
