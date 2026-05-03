import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { log } from "./index";

// Episodic memory: timestamped personal moments extracted from conversations.
// Stored in PostgreSQL only — no RAM cache — safe under Render's 512MB limit.
// Max 50 episodes per user per guild; oldest are pruned automatically.
//
// Each episode has:
//   - category: event | preference | opinion | relationship | goal | lifestyle
//   - probe: whether Fred should naturally check in on it (ongoing situation, recent event, active goal)
//   - topic: short topic tag for relevance grouping

const MAX_EPISODES = 50;
const MAX_EPISODE_CHARS = 200;
const EXTRACTION_QUEUE_CAP = 25;

// How old (ms) an episode has to be before it moves from "check in on" to "established context"
const PROBE_RECENCY_MS = 10 * 24 * 60 * 60 * 1000; // 10 days

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
        category TEXT NOT NULL DEFAULT 'event',
        probe BOOLEAN NOT NULL DEFAULT FALSE,
        topic TEXT NOT NULL DEFAULT '',
        confidence INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_episodes_user_guild_idx
        ON user_episodes(user_id, guild_id)
    `);
    // Safe migrations for existing installs
    await db.execute(sql`ALTER TABLE user_episodes ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'event'`);
    await db.execute(sql`ALTER TABLE user_episodes ADD COLUMN IF NOT EXISTS probe BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE user_episodes ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE user_episodes ADD COLUMN IF NOT EXISTS confidence INT NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE user_episodes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
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

interface ExtractedEpisode {
  text: string;
  category: string;
  probe: boolean;
  topic: string;
}

async function extractEpisodeText(content: string): Promise<ExtractedEpisode | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: { temperature: 0.1, maxOutputTokens: 80 },
    });
    const prompt = [
      "Extract a single memorable personal detail from this Discord message, if one exists.",
      "",
      "CATEGORIES — pick exactly one:",
      "  event      — a specific life thing that happened or will happen (exam result, job interview, breakup, illness, trip, achievement, loss)",
      "  preference — something they like, love, hate, or always/never do (music taste, food, hobbies, media)",
      "  opinion    — a strong stance or belief they've stated",
      "  relationship — something about a specific person in their life (friend, partner, family, pet)",
      "  goal       — something they're working toward or planning",
      "  lifestyle  — how they live (diet, sleep, fitness, job, city, identity, mental health)",
      "",
      "PROBE — output true if Fred should naturally check in on this later (ongoing events, active goals, recent struggles, pending outcomes).",
      "        output false for established preferences, opinions, or completed events.",
      "",
      "TOPIC — 1-3 word tag for the subject area (e.g. 'university', 'relationship', 'music', 'health', 'career', 'gaming')",
      "",
      "NOT worth extracting: generic questions, greetings, bot commands, casual banter with no personal content.",
      "NEVER extract: anything about 'fred', 'the bot', or 'the assistant' as a person in the user's life. The message is addressed TO fred — fred is not a human in their social circle. 'i love talking to fred' is not a relationship worth storing.",
      "",
      "Output format — EXACTLY this, one line, pipe-separated:",
      "category|probe|topic|text",
      "",
      "Rules for text: ≤20 words, start with 'mentioned' or 'said they'. Example:",
      "event|true|university|mentioned they have a final exam on thursday and are panicking",
      "",
      "If nothing noteworthy, output exactly: NULL",
      "",
      `Message: "${content.slice(0, 400)}"`,
      "",
      "Output:",
    ].join("\n");

    const result = await model.generateContent(prompt);
    const raw = result?.response?.text()?.trim() ?? "";
    if (!raw || /^null\.?$/i.test(raw)) return null;

    const parts = raw.split("|");
    if (parts.length < 4) return null;

    const [category, probeStr, topic, ...textParts] = parts;
    const text = textParts.join("|").trim().slice(0, MAX_EPISODE_CHARS);
    if (!text || /^null$/i.test(text)) return null;

    const validCategories = ["event", "preference", "opinion", "relationship", "goal", "lifestyle"];
    const safeCategory = validCategories.includes(category?.trim() ?? "") ? category.trim() : "event";
    const probe = probeStr?.trim().toLowerCase() === "true";
    const safeTopic = (topic?.trim() ?? "").slice(0, 40);

    return { text, category: safeCategory, probe, topic: safeTopic };
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

      // Deduplication: for stable categories (not one-off events), check if we already
      // have an entry with the same topic+category. If so, update it and bump confidence
      // (max 3) rather than creating a duplicate row.
      const isStable = episode.category !== "event";
      if (isStable && episode.topic) {
        const existing: any = await db.execute(sql`
          SELECT id, confidence FROM user_episodes
          WHERE user_id = ${userId} AND guild_id = ${guildId}
            AND category = ${episode.category}
            AND topic = ${episode.topic}
          ORDER BY updated_at DESC
          LIMIT 1
        `);
        const rows = (existing?.rows ?? existing) as Array<{ id: number; confidence: number }> | undefined;
        if (rows && rows.length > 0) {
          const existingId = Number(rows[0].id);
          const newConfidence = Math.min(Number(rows[0].confidence ?? 1) + 1, 3);
          await db.execute(sql`
            UPDATE user_episodes
            SET episode = ${episode.text},
                event_label = ${label},
                probe = ${episode.probe},
                confidence = ${newConfidence},
                updated_at = now()
            WHERE id = ${existingId}
          `);
          log(`[EpisodicMemory] Updated for ${userId} [${episode.category}/conf${newConfidence}]: ${episode.text}`, "memory");
          return;
        }
      }

      // New episode — insert fresh.
      await db.execute(sql`
        INSERT INTO user_episodes (user_id, guild_id, episode, event_label, category, probe, topic, confidence)
        VALUES (${userId}, ${guildId}, ${episode.text}, ${label}, ${episode.category}, ${episode.probe}, ${episode.topic}, 1)
      `);
      // Prune oldest beyond the per-user-per-guild limit.
      await db.execute(sql`
        DELETE FROM user_episodes
        WHERE user_id = ${userId} AND guild_id = ${guildId}
          AND id NOT IN (
            SELECT id FROM user_episodes
            WHERE user_id = ${userId} AND guild_id = ${guildId}
            ORDER BY updated_at DESC
            LIMIT ${MAX_EPISODES}
          )
      `);
      log(`[EpisodicMemory] Stored for ${userId} [${episode.category}${episode.probe ? "/probe" : ""}]: ${episode.text}`, "memory");
    } catch (err: any) {
      log(`[EpisodicMemory] Failed to store episode: ${err.message}`, "memory");
    }
  });

  void drainExtractionQueue();
}

export async function getEpisodicContext(userId: string, guildId: string): Promise<string | null> {
  try {
    const result: any = await db.execute(sql`
      SELECT episode, event_label, category, probe, topic, confidence, created_at, updated_at
      FROM user_episodes
      WHERE user_id = ${userId} AND guild_id = ${guildId}
      ORDER BY updated_at DESC
      LIMIT 30
    `);
    const rows = (result?.rows ?? result) as Array<{
      episode: string;
      event_label: string;
      category: string;
      probe: boolean;
      topic: string;
      confidence: number;
      created_at: string;
      updated_at: string;
    }>;
    if (!rows || rows.length === 0) return null;

    const now = Date.now();

    // Split into: things to check in on naturally vs established background context.
    // Low confidence (1) items are treated as tentative — kept in background only,
    // never surfaced as check-ins, to reduce inaccurate probing.
    const checkOn: string[] = [];
    const established: string[] = [];
    const tentative: string[] = [];
    const seen = new Set<string>();

    for (const r of rows) {
      // Rows are already deduped at write-time for stable categories, but guard anyway
      const dedupeKey = `${r.category}:${r.topic}`;
      if (seen.has(dedupeKey) && r.category !== "event") continue;
      seen.add(dedupeKey);

      const confidence = Number(r.confidence ?? 1);
      const ageMs = now - new Date(r.updated_at ?? r.created_at).getTime();
      const isRecent = ageMs < PROBE_RECENCY_MS;
      const isProbe = r.probe === true || (r.probe as any) === "t" || (r.probe as any) === 1;

      if (confidence === 1) {
        // Single-mention — tentative; use as soft background only, don't probe
        tentative.push(r.episode);
      } else if ((isProbe && isRecent) || (isRecent && r.category === "event")) {
        checkOn.push(`${r.event_label}: ${r.episode}`);
      } else {
        established.push(r.episode);
      }

      if (checkOn.length >= 5 && established.length >= 8) break;
    }

    const parts: string[] = ["fred's memory of this person:"];

    if (established.length > 0) {
      parts.push(`confirmed background (use freely): ${established.slice(0, 8).join(". ")}.`);
    }

    if (tentative.length > 0) {
      parts.push(`tentative (mentioned once — treat carefully, don't assert): ${tentative.slice(0, 4).join(". ")}.`);
    }

    if (checkOn.length > 0) {
      parts.push(`check in on naturally — weave these in as questions or callbacks, don't announce you remember them:\n${checkOn.slice(0, 5).map((e) => `  - ${e}`).join("\n")}`);
    }

    return parts.join("\n");
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
