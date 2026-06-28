import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const qotdLog = sqliteTable("qotd_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  question: text("question").notNull(),
  optionA: text("option_a"),
  optionB: text("option_b"),
  messageId: text("message_id"),
  channelId: text("channel_id").notNull(),
  sentAt: text("sent_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export type QotdEntry = typeof qotdLog.$inferSelect;
export type InsertQotdEntry = typeof qotdLog.$inferInsert;

export const userMemory = sqliteTable("user_memory", {
  userId: text("user_id").primaryKey(),
  dossier: text("dossier").notNull(),
  sureties: text("sureties"),
});

export const insertUserMemorySchema = createInsertSchema(userMemory);
export type InsertUserMemory = z.infer<typeof insertUserMemorySchema>;
export type UserMemory = typeof userMemory.$inferSelect;

export const botMeta = sqliteTable("bot_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const guildMemory = sqliteTable("guild_memory", {
  guildId: text("guild_id").primaryKey(),
  lore: text("lore").notNull().default(""),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export type GuildMemoryRow = typeof guildMemory.$inferSelect;
export type BotMetaRow = typeof botMeta.$inferSelect;

export const guildSettings = sqliteTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  personaOverride: text("persona_override"),
  temperature: integer("temperature").notNull().default(7),
  chattiness: integer("chattiness").notNull().default(5),
  proactivity: integer("proactivity").notNull().default(3),
  memoryEnabled: integer("memory_enabled", { mode: "boolean" }).notNull().default(true),
  responseLength: integer("response_length").notNull().default(3),
  language: text("language").notNull().default("auto"),
  deadChatChannelId: text("dead_chat_channel_id"),
  allowedChannels: text("allowed_channels"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedBy: text("updated_by"),
});

export type GuildSettings = typeof guildSettings.$inferSelect;
export type InsertGuildSettings = typeof guildSettings.$inferInsert;

export const guildSettingsSchema = z.object({
  personaOverride: z.string().max(1000).nullable().optional(),
  temperature: z.number().int().min(1).max(10).optional(),
  chattiness: z.number().int().min(0).max(10).optional(),
  proactivity: z.number().int().min(0).max(10).optional(),
  memoryEnabled: z.boolean().optional(),
  responseLength: z.number().int().min(1).max(5).optional(),
  language: z.enum(["auto", "en", "nl"]).optional(),
  deadChatChannelId: z.string().max(30).nullable().optional(),
  allowedChannels: z.string().max(500).nullable().optional(),
});

export type GuildSettingsUpdate = z.infer<typeof guildSettingsSchema>;

// ── Economy: Gems & Gold ──────────────────────────────────────────────────────

export const gemBalances = sqliteTable("gem_balances", {
  userId: text("user_id").primaryKey(),
  freeGems: integer("free_gems").notNull().default(20),
  paidGems: integer("paid_gems").notNull().default(0),
  gold: integer("gold").notNull().default(0),
  lastDailyAt: text("last_daily_at"),
  lastVoteAt: text("last_vote_at"),
  totalPulls: integer("total_pulls").notNull().default(0),
  totalMessagesSent: integer("total_messages_sent").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export type GemBalance = typeof gemBalances.$inferSelect;

// ── Gacha: Character Collection ───────────────────────────────────────────────

export const waifuCollection = sqliteTable("waifu_collection", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  guildId: text("guild_id"),
  characterId: integer("character_id").notNull(),
  characterName: text("character_name").notNull(),
  seriesName: text("series_name"),
  imageUrl: text("image_url"),
  rarity: text("rarity").notNull(),
  rarityStars: integer("rarity_stars").notNull(),
  isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
  obtainedAt: text("obtained_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export type WaifuCard = typeof waifuCollection.$inferSelect;

// ── Voting Log ────────────────────────────────────────────────────────────────

export const votingLog = sqliteTable("voting_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull().default("topgg"),
  votedAt: text("voted_at").notNull().$defaultFn(() => new Date().toISOString()),
  gemsAwarded: integer("gems_awarded").notNull().default(10),
});

export type VotingEntry = typeof votingLog.$inferSelect;
