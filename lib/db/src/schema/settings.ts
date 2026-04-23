import { pgTable, text, integer, boolean, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const smtpSettingsTable = pgTable("smtp_settings", {
  id: serial("id").primaryKey(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false),
  username: text("username"),
  password: text("password"),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSmtpSettingsSchema = createInsertSchema(smtpSettingsTable).omit({ id: true, updatedAt: true });
export type InsertSmtpSettings = z.infer<typeof insertSmtpSettingsSchema>;
export type SmtpSettings = typeof smtpSettingsTable.$inferSelect;
