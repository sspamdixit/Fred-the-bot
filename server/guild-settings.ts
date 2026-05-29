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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  tableReady = true;
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  await ensureGuildSettingsTable();
  const rows = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  if (rows[0]) return rows[0];
  return {
    guildId,
    ...DEFAULT_GUILD_SETTINGS,
    updatedAt: new Date(),
    updatedBy: null,
  };
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
        updatedAt: new Date(),
        updatedBy: updatedBy ?? null,
      },
    })
    .returning();
  return result[0];
}
