import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const scriptFoldersTable = pgTable("script_folders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  icon: text("icon").notNull().default("Folder"),
  color: text("color").notNull().default("amber"),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ScriptFolder = typeof scriptFoldersTable.$inferSelect;
