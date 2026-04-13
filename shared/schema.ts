import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, varchar, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const qotdLog = pgTable("qotd_log", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  question: text("question").notNull(),
  optionA: text("option_a"),
  optionB: text("option_b"),
  messageId: text("message_id"),
  channelId: text("channel_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QotdEntry = typeof qotdLog.$inferSelect;
export type InsertQotdEntry = typeof qotdLog.$inferInsert;

export const aiProviderConfigs = pgTable("ai_provider_configs", {
  provider: text("provider").primaryKey(),
  encryptedApiKey: text("encrypted_api_key"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiProviderConfigSchema = createInsertSchema(aiProviderConfigs);

export type AiProviderConfig = typeof aiProviderConfigs.$inferSelect;
export type InsertAiProviderConfig = z.infer<typeof insertAiProviderConfigSchema>;
