import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scriptsTable } from "./scripts";

export const executionsTable = pgTable("executions", {
  id: serial("id").primaryKey(),
  scriptId: integer("script_id").references(() => scriptsTable.id, { onDelete: "set null" }),
  executedBy: text("executed_by").notNull(),
  success: boolean("success").notNull(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exit_code").notNull(),
  executionTimeMs: integer("execution_time_ms").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExecutionSchema = createInsertSchema(executionsTable).omit({ id: true, createdAt: true });
export type InsertExecution = z.infer<typeof insertExecutionSchema>;
export type Execution = typeof executionsTable.$inferSelect;
