import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { log } from "./index";

// Episodic memory: timestamped personal moments extracted from conversations.
// Stored in PostgreSQL only — no RAM cache — safe under Render's 512MB limit.
// Max 20 episodes per user per guild; oldest are pruned automatically.

const MAX_EPISODES = 20;
const MAX_EPISODE_CHARS = 120;
const EXTRACTION_QUEUE_CAP = 25;

let tableReady = false;

export async function ensureEpisodesTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_episodes (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        episode TEXT NOT NULL,
        event_label TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_episodes_user_guild_idx
        ON user_episodes(user_id, guild_id)
    `);
    tableReady = true;
    log("[EpisodicMemory] user_episodes table ready.", "memory");
  } catch (err: any) {
    log(`[EpisodicMemory] Table init failed: ${err.message}`, "memory");
  }
}

function humanDateLabel(): string {
  const now = new Date();
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const months = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];
  return `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${now.getUTCDate()}`;
}

async function extractEpisodeText(content: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: { temperature: 0.1, maxOutputTokens: 60 },
    });
    const prompt = [
      "Extract a single memorable personal fact or event from this Discord message, if one exists.",
      "Worth extracting: health news, results (passed/failed/got in/rejected), relationships, worries, plans, life events, achievements, losses, strong personal updates.",
      "NOT worth extracting: generic questions, greetings, bot commands, music requests, casual banter with no personal content.",
      "Write it in ≤15 words starting with 'mentioned' or 'said they' — e.g. 'mentioned they got into university' or 'said they failed their driving test'.",
      "If nothing noteworthy exists, output exactly NULL.",
      "",
      `Message: "${content.slice(0, 400)}"`,
      "",
      "Output (one line only):",
    ].join("\n");
    const result = await model.generateContent(prompt);
    const text = result?.response?.text()?.trim() ?? "";
    if (!text || /^null\.?$/i.test(text)) return null;
    return text.slice(0, MAX_EPISODE_CHARS);
  } catch (err: any) {
    log(`[EpisodicMemory] Extraction failed: ${err.message}`, "memory");
    return null;
  }
}

const extractionQueue: Array<() => Promise<void>> = [];
let extracting = false;

async function drainExtractionQueue(): Promise<void> {
  if (extracting) return;
  extracting = true;
  try {
    while (extractionQueue.length > 0) {
      const job = extractionQueue.shift();
      await job?.();
    }
  } finally {
    extracting = false;
  }
}

export function queueEpisodeExtraction(userId: string, guildId: string, content: string): void {
  if (!userId || !guildId || !content?.trim()) return;
  if (extractionQueue.length >= EXTRACTION_QUEUE_CAP) return;

  extractionQueue.push(async () => {
    try {
      const episode = await extractEpisodeText(content);
      if (!episode) return;
      const label = humanDateLabel();
      await db.execute(sql`
        INSERT INTO user_episodes (user_id, guild_id, episode, event_label)
        VALUES (${userId}, ${guildId}, ${episode}, ${label})
      `);
      // Prune oldest if over the per-user-per-guild limit.
      await db.execute(sql`
        DELETE FROM user_episodes
        WHERE user_id = ${userId} AND guild_id = ${guildId}
          AND id NOT IN (
            SELECT id FROM user_episodes
            WHERE user_id = ${userId} AND guild_id = ${guildId}
            ORDER BY created_at DESC
            LIMIT ${MAX_EPISODES}
          )
      `);
      log(`[EpisodicMemory] Stored for ${userId}: ${episode}`, "memory");
    } catch (err: any) {
      log(`[EpisodicMemory] Failed to store episode: ${err.message}`, "memory");
    }
  });

  void drainExtractionQueue();
}

export async function getEpisodicContext(userId: string, guildId: string): Promise<string | null> {
  try {
    const result: any = await db.execute(sql`
      SELECT episode, event_label, created_at
      FROM user_episodes
      WHERE user_id = ${userId} AND guild_id = ${guildId}
      ORDER BY created_at DESC
      LIMIT 5
    `);
    const rows = (result?.rows ?? result) as Array<{
      episode: string;
      event_label: string;
      created_at: string;
    }>;
    if (!rows || rows.length === 0) return null;

    const lines = [...rows]
      .reverse() // chronological order for narrative flow
      .map((r) => `- ${r.event_label}: ${r.episode}`)
      .join("\n");

    return `things fred remembers about this person:\n${lines}`;
  } catch {
    return null;
  }
}

export async function deleteUserEpisodes(userId: string, guildId: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM user_episodes WHERE user_id = ${userId} AND guild_id = ${guildId}
    `);
  } catch { /* ignore */ }
}
