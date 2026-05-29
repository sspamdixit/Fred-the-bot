import { db } from "./db";
import { guildSettings } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { GuildSettings, GuildSettingsUpdate } from "@shared/schema";

export const DEFAULT_GUILD_SETTINGS: Omit<GuildSettings, "guildId" | "updatedAt" | "updatedBy"> = {
  personaOverride: null,
  temperature: 7,
  chattiness: 5,
  proactivity: 3,
  memoryEnabled: true,
  responseLength: 3,
  language: "auto",
  deadChatChannelId: null,
  allowedChannels: null,
};

let tableReady = false;

export async function ensureGuildSettingsTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      persona_override TEXT,
      temperature INTEGER NOT NULL DEFAULT 7,
      chattiness INTEGER NOT NULL DEFAULT 5,
      proactivity INTEGER NOT NULL DEFAULT 3,
      memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      response_length INTEGER NOT NULL DEFAULT 3,
      language TEXT NOT NULL DEFAULT 'auto',
      dead_chat_channel_id TEXT,
      allowed_channels TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await db.execute(sql`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS dead_chat_channel_id TEXT`);
  await db.execute(sql`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS allowed_channels TEXT`);
  tableReady = true;
}

const settingsCache = new Map<string, { settings: GuildSettings; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

export function invalidateGuildSettingsCache(guildId: string): void {
  settingsCache.delete(guildId);
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  await ensureGuildSettingsTable();
  const cached = settingsCache.get(guildId);
  if (cached && Date.now() < cached.expiresAt) return cached.settings;

  const rows = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  const result: GuildSettings = rows[0] ?? {
    guildId,
    ...DEFAULT_GUILD_SETTINGS,
    updatedAt: new Date(),
    updatedBy: null,
  };

  settingsCache.set(guildId, { settings: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export async function upsertGuildSettings(
  guildId: string,
  updates: GuildSettingsUpdate,
  updatedBy?: string,
): Promise<GuildSettings> {
  await ensureGuildSettingsTable();
  const result = await db
    .insert(guildSettings)
    .values({
      guildId,
      ...DEFAULT_GUILD_SETTINGS,
      ...updates,
      updatedAt: new Date(),
      updatedBy: updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: {
        ...(updates.personaOverride !== undefined ? { personaOverride: updates.personaOverride } : {}),
        ...(updates.temperature !== undefined ? { temperature: updates.temperature } : {}),
        ...(updates.chattiness !== undefined ? { chattiness: updates.chattiness } : {}),
        ...(updates.proactivity !== undefined ? { proactivity: updates.proactivity } : {}),
        ...(updates.memoryEnabled !== undefined ? { memoryEnabled: updates.memoryEnabled } : {}),
        ...(updates.responseLength !== undefined ? { responseLength: updates.responseLength } : {}),
        ...(updates.language !== undefined ? { language: updates.language } : {}),
        ...(updates.deadChatChannelId !== undefined ? { deadChatChannelId: updates.deadChatChannelId } : {}),
        ...(updates.allowedChannels !== undefined ? { allowedChannels: updates.allowedChannels } : {}),
        updatedAt: new Date(),
        updatedBy: updatedBy ?? null,
      },
    })
    .returning();
  invalidateGuildSettingsCache(guildId);
  return result[0];
}
