import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { log } from "./index";

interface GuildLoreCache {
  lore: string;
  fetchedAt: number;
}

const LORE_CACHE_TTL_MS = 30 * 60 * 1000;
const LORE_UPDATE_EVERY_N = 45;
const MAX_GUILD_CACHE = 50;
const MAX_LORE_WORDS = 200;

let tableReady = false;
const loreCache = new Map<string, GuildLoreCache>();
const messageCounters = new Map<string, number>();
const pendingExtractions = new Set<string>();

export async function ensureGuildMemoryTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS guild_memory (
        guild_id TEXT PRIMARY KEY,
        lore TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    tableReady = true;
    log("[GuildMemory] guild_memory table ready.", "memory");
  } catch (err: any) {
    log(`[GuildMemory] Table init failed: ${err.message}`, "memory");
  }
}

export async function getGuildLore(guildId: string): Promise<string> {
  const cached = loreCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < LORE_CACHE_TTL_MS) {
    return cached.lore;
  }

  try {
    const result: any = await db.execute(sql`
      SELECT lore FROM guild_memory WHERE guild_id = ${guildId}
    `);
    const rows = result?.rows ?? result;
    const lore = String(rows[0]?.lore ?? "").trim();

    if (loreCache.size >= MAX_GUILD_CACHE) {
      const oldestKey = loreCache.keys().next().value;
      if (oldestKey) loreCache.delete(oldestKey);
    }
    loreCache.set(guildId, { lore, fetchedAt: Date.now() });
    return lore;
  } catch {
    return "";
  }
}

export function tickGuildMessageCounter(guildId: string, recentMessages: string): void {
  const count = (messageCounters.get(guildId) ?? 0) + 1;
  messageCounters.set(guildId, count);
  if (count >= LORE_UPDATE_EVERY_N && !pendingExtractions.has(guildId)) {
    messageCounters.set(guildId, 0);
    void extractGuildLore(guildId, recentMessages).catch(() => {});
  }
}

async function extractGuildLore(guildId: string, recentMessages: string): Promise<void> {
  if (pendingExtractions.has(guildId)) return;
  pendingExtractions.add(guildId);
  try {
    const existing = await getGuildLore(guildId);
    const key = process.env.GEMINI_API_KEY;
    if (!key) return;

    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: { temperature: 0.3, maxOutputTokens: 320 },
    });

    const prompt = [
      `Update the "server lore" record for a Discord community. Server lore is a compact, living summary of what makes this specific group of people unique.`,
      ``,
      `Capture: inside jokes, recurring memes or references, nicknames, running gags, shared obsessions, events or drama that defined the community, topics that always come up, things people here clearly care about deeply. Pay special attention to relationships between specific named users — who's close with who, long-running beefs or rivalries, who always agrees with or defends who, bromances, inside tensions, who tends to trigger reactions in who. Name names when you have them.`,
      ``,
      `Do NOT include: generic greetings, bot commands, music requests, basic factual statements with no community character.`,
      ``,
      `If nothing new is worth adding, return the existing lore unchanged. If you update it, weave old and new together naturally — don't just append.`,
      ``,
      `Max ${MAX_LORE_WORDS} words. Plain lowercase prose. No bullets, no headers, no labels. Write it as dense, useful context.`,
      ``,
      `Existing lore:`,
      existing || "(none yet — build it fresh from what you see below)",
      ``,
      `Recent messages:`,
      recentMessages.slice(0, 3000),
      ``,
      `Updated lore:`,
    ].join("\n");

    const result = await model.generateContent(prompt);
    const newLore = result?.response?.text()?.trim() ?? "";
    if (!newLore || newLore === existing) return;

    await db.execute(sql`
      INSERT INTO guild_memory (guild_id, lore, updated_at)
      VALUES (${guildId}, ${newLore}, now())
      ON CONFLICT (guild_id) DO UPDATE
        SET lore = EXCLUDED.lore, updated_at = EXCLUDED.updated_at
    `);
    loreCache.set(guildId, { lore: newLore, fetchedAt: Date.now() });
    log(`[GuildMemory] Lore updated for ${guildId} (${newLore.split(/\s+/).length} words).`, "memory");
  } catch (err: any) {
    log(`[GuildMemory] Extraction failed for ${guildId}: ${err.message}`, "memory");
  } finally {
    pendingExtractions.delete(guildId);
  }
}
