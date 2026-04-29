import { pgTable, integer, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { scriptsTable } from "./scripts";
import { departmentsTable } from "./departments";

export const scriptDepartmentsTable = pgTable(
  "script_departments",
  {
    scriptId: integer("script_id")
      .notNull()
      .references(() => scriptsTable.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scriptId, t.departmentId] })],
);

export type ScriptDepartment = typeof scriptDepartmentsTable.$inferSelect;
