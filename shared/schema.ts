import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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

export const userMemory = pgTable("user_memory", {
  userId: text("user_id").primaryKey(),
  dossier: text("dossier").notNull(),
  sureties: text("sureties"),
});

export const insertUserMemorySchema = createInsertSchema(userMemory);

export type InsertUserMemory = z.infer<typeof insertUserMemorySchema>;
export type UserMemory = typeof userMemory.$inferSelect;

export const botMeta = pgTable("bot_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const guildMemory = pgTable("guild_memory", {
  guildId: text("guild_id").primaryKey(),
  lore: text("lore").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GuildMemoryRow = typeof guildMemory.$inferSelect;
export type BotMetaRow = typeof botMeta.$inferSelect;

export const savedPlaylists = pgTable("saved_playlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedPlaylist = typeof savedPlaylists.$inferSelect;

export const playlistTracks = pgTable("playlist_tracks", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull(),
  position: integer("position").notNull(),
  encoded: text("encoded").notNull(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  uri: text("uri").notNull(),
  duration: integer("duration").notNull(),
  artworkUrl: text("artwork_url"),
});

export type PlaylistTrack = typeof playlistTracks.$inferSelect;

// ── Per-guild settings ────────────────────────────────────────────────────────

export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  personaOverride: text("persona_override"),
  temperature: integer("temperature").notNull().default(7),
  chattiness: integer("chattiness").notNull().default(5),
  proactivity: integer("proactivity").notNull().default(3),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  responseLength: integer("response_length").notNull().default(3),
  language: text("language").notNull().default("auto"),
  deadChatChannelId: text("dead_chat_channel_id"),
  allowedChannels: text("allowed_channels"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
