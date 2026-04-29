import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { log } from "./index";

const EMBEDDING_DIMS = 768;
const HYPOCRISY_COOLDOWN_MS = 2 * 60 * 1000;
const HYPOCRISY_DISTANCE_THRESHOLD = 0.15;
const RAM_SOFT_LIMIT_MB = 480;
const QUEUE_DELAY_MS = 120;
const MIN_INGEST_LENGTH = 8;
const MAX_INGEST_LENGTH = 1500;

let embeddingClient: GoogleGenerativeAI | null = null;
let embeddingDisabled = false;
let tableReady = false;

function getEmbeddingClient(): GoogleGenerativeAI | null {
  if (embeddingDisabled) return null;
  if (embeddingClient) return embeddingClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    log("[SemanticMemory] GEMINI_API_KEY not set — semantic memory disabled.", "memory");
    embeddingDisabled = true;
    return null;
  }
  embeddingClient = new GoogleGenerativeAI(key);
  return embeddingClient;
}

function memoryUsageMB(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

function isMemoryHigh(): boolean {
  return memoryUsageMB() > RAM_SOFT_LIMIT_MB;
}

function formatVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

function parseVector(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as number[];
  const text = String(raw).trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  try {
    return JSON.parse(text) as number[];
  } catch {
    return null;
  }
}

export async function ensureSemanticMemoryTable(): Promise<void> {
  if (tableReady) return;
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(${EMBEDDING_DIMS}) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_memories_user_idx
        ON user_memories(user_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_memories_guild_idx
        ON user_memories(guild_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_memories_user_guild_idx
        ON user_memories(user_id, guild_id)
    `);
    tableReady = true;
    log("[SemanticMemory] user_memories table ready (pgvector enabled).", "memory");
  } catch (err: any) {
    log(`[SemanticMemory] Failed to initialize table: ${err.message}`, "memory");
    throw err;
  }
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const client = getEmbeddingClient();
  if (!client) return null;
  try {
    const model = client.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    const values = result?.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) {
      log(`[SemanticMemory] Unexpected embedding length: ${values?.length}`, "memory");
      return null;
    }
    return values;
  } catch (err: any) {
    log(`[SemanticMemory] Embedding failed: ${err.message}`, "memory");
    return null;
  }
}

async function callGemini(prompt: string, maxOutputTokens = 350): Promise<string | null> {
  const client = getEmbeddingClient();
  if (!client) return null;
  const candidates = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash-lite"];
  for (const modelName of candidates) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.85, maxOutputTokens },
      });
      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.()?.trim();
      if (text) return text;
    } catch (err: any) {
      log(`[SemanticMemory] Gemini call (${modelName}) failed: ${err.message}`, "memory");
    }
  }
  return null;
}

const ingestQueue: Array<() => Promise<void>> = [];
let queueProcessing = false;

async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (ingestQueue.length > 0) {
      const job = ingestQueue.shift();
      if (!job) continue;
      if (isMemoryHigh()) {
        log(`[SemanticMemory] RAM ${memoryUsageMB().toFixed(0)}MB > soft cap — dropping ${ingestQueue.length + 1} pending memory job(s).`, "memory");
        ingestQueue.length = 0;
        break;
      }
      try {
        await job();
      } catch (err: any) {
        log(`[SemanticMemory] Ingest job failed: ${err.message}`, "memory");
      }
      await new Promise((r) => setTimeout(r, QUEUE_DELAY_MS));
    }
  } finally {
    queueProcessing = false;
  }
}

export function queueMemoryIngestion(userId: string, guildId: string | null | undefined, content: string): void {
  if (!userId || !guildId) return;
  if (embeddingDisabled || !process.env.GEMINI_API_KEY) return;
  const trimmed = content?.trim();
  if (!trimmed || trimmed.length < MIN_INGEST_LENGTH) return;
  if (isMemoryHigh()) return;
  if (ingestQueue.length > 50) return;

  const snippet = trimmed.length > MAX_INGEST_LENGTH ? trimmed.slice(0, MAX_INGEST_LENGTH) : trimmed;

  ingestQueue.push(async () => {
    const embedding = await generateEmbedding(snippet);
    if (!embedding) return;
    const vectorLiteral = formatVector(embedding);
    await db.execute(sql`
      INSERT INTO user_memories (user_id, guild_id, content, embedding)
      VALUES (${userId}, ${guildId}, ${snippet}, ${vectorLiteral}::vector)
    `);
  });

  void processQueue();
}

interface SimilarMemoryRow {
  id: number;
  content: string;
  distance: number;
  created_at: string;
}

async function findMostSimilarMemory(
  userId: string,
  guildId: string,
  embedding: number[],
  excludeContent: string,
): Promise<SimilarMemoryRow | null> {
  const vectorLiteral = formatVector(embedding);
  const result: any = await db.execute(sql`
    SELECT id, content, created_at, (embedding <=> ${vectorLiteral}::vector) AS distance
    FROM user_memories
    WHERE user_id = ${userId}
      AND guild_id = ${guildId}
      AND content <> ${excludeContent}
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT 1
  `);
  const rows = (result?.rows ?? result) as SimilarMemoryRow[] | undefined;
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    content: String(row.content),
    distance: Number((row as any).distance),
    created_at: String((row as any).created_at),
  };
}

const hypocrisyCooldowns = new Map<string, number>();

export interface HypocrisyContext {
  userId: string;
  guildId: string;
  authorName: string;
  content: string;
}

export async function runHypocrisyEngine(ctx: HypocrisyContext): Promise<string | null> {
  if (embeddingDisabled || !process.env.GEMINI_API_KEY) return null;
  const trimmed = ctx.content?.trim();
  if (!trimmed || trimmed.length < 20) return null;

  const last = hypocrisyCooldowns.get(ctx.userId);
  if (last && Date.now() - last < HYPOCRISY_COOLDOWN_MS) return null;
  hypocrisyCooldowns.set(ctx.userId, Date.now());

  if (isMemoryHigh()) return null;

  try {
    const embedding = await generateEmbedding(trimmed.slice(0, MAX_INGEST_LENGTH));
    if (!embedding) return null;
    const match = await findMostSimilarMemory(ctx.userId, ctx.guildId, embedding, trimmed);
    if (!match) return null;
    if (!Number.isFinite(match.distance) || match.distance > HYPOCRISY_DISTANCE_THRESHOLD) return null;

    const prompt = [
      "You are Fred, a genius AI with a perfect, condescending memory. Analyze these two statements from the same user.",
      "If they are conceptually contradictory, hypocritical, or show the user has changed their mind in a pathetic way, write a short, sharp, arrogant roast (1-2 sentences, all lowercase, no emojis, no quoting full sentences back).",
      "If they are simply consistent or just on the same topic without contradiction, return exactly NULL and nothing else.",
      "",
      `Stored memory (older statement from ${ctx.authorName}): "${match.content.replace(/"/g, "'")}"`,
      `Current message from ${ctx.authorName}: "${trimmed.replace(/"/g, "'")}"`,
    ].join("\n");

    const reply = await callGemini(prompt, 200);
    if (!reply) return null;
    const cleaned = reply.replace(/^["'\s]+|["'\s]+$/g, "").trim();
    if (!cleaned || cleaned.toUpperCase() === "NULL" || /^null\.?$/i.test(cleaned)) return null;
    log(`[Hypocrisy] Caught ${ctx.authorName} (distance ${match.distance.toFixed(3)})`, "memory");
    return cleaned;
  } catch (err: any) {
    log(`[Hypocrisy] Failed: ${err.message}`, "memory");
    return null;
  }
}

export async function searchServerLore(guildId: string, query: string): Promise<string | null> {
  if (!query.trim()) return "give me a topic. '?lore' on its own is just you staring into the void.";
  if (embeddingDisabled || !process.env.GEMINI_API_KEY) return null;
  if (isMemoryHigh()) return "memory's fried right now. ask again later.";

  const embedding = await generateEmbedding(query.slice(0, 500));
  if (!embedding) return null;
  const vectorLiteral = formatVector(embedding);

  const result: any = await db.execute(sql`
    SELECT user_id, content, created_at, (embedding <=> ${vectorLiteral}::vector) AS distance
    FROM user_memories
    WHERE guild_id = ${guildId}
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT 8
  `);
  const rows = (result?.rows ?? result) as Array<{ user_id: string; content: string; distance: number }> | undefined;
  if (!rows || rows.length === 0) {
    return `nobody in this server has ever said anything about "${query}". congrats on the originality, i guess.`;
  }

  const lines = rows
    .filter((r) => Number(r.distance) < 0.7)
    .slice(0, 6)
    .map((r) => `- <@${r.user_id}>: ${String(r.content).slice(0, 220)}`)
    .join("\n");

  if (!lines) return `nothing meaningful surfaced for "${query}". the lore is dry.`;

  const prompt = [
    "You are Fred, a snarky, condescending Discord bot with a perfect memory.",
    `A user just asked you about the server's lore on the topic: "${query}".`,
    "Below are real messages people in this server have actually said, retrieved by semantic similarity to that topic.",
    "Summarize the 'server lore' on this topic in 3-5 sentences. Be snarky, name-drop the users by their <@user_id> mention so Discord renders them, and reference specific things they said.",
    "Stay all lowercase. No emojis. No bullet lists in your output — write it as flowing snark.",
    "If the messages don't really address the topic, mock the user for asking.",
    "",
    "retrieved messages:",
    lines,
  ].join("\n");

  const reply = await callGemini(prompt, 400);
  return reply ?? `the lore on "${query}" exists but my brain just refused to summarize it. try again.`;
}

export async function buildUserDossier(userId: string, guildId: string, displayName: string): Promise<string | null> {
  if (embeddingDisabled || !process.env.GEMINI_API_KEY) return null;
  if (isMemoryHigh()) return "memory's fried right now. ask again later.";

  const countResult: any = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM user_memories
    WHERE user_id = ${userId} AND guild_id = ${guildId}
  `);
  const countRows = (countResult?.rows ?? countResult) as Array<{ count: number }> | undefined;
  const total = Number(countRows?.[0]?.count ?? 0);

  if (total === 0) {
    return `i have nothing on ${displayName}. they've either never typed in this server or they've been so forgettable my embeddings refused to remember.`;
  }
  if (total < 3) {
    return `${displayName} has barely said anything in this server. building a profile from ${total} message${total === 1 ? "" : "s"} would be journalistic malpractice.`;
  }

  const anchorResult: any = await db.execute(sql`
    SELECT id, content, embedding::text AS embedding_text
    FROM user_memories
    WHERE user_id = ${userId} AND guild_id = ${guildId}
    ORDER BY random()
    LIMIT 1
  `);
  const anchorRows = (anchorResult?.rows ?? anchorResult) as Array<{ id: number; content: string; embedding_text: string }> | undefined;
  const anchor = anchorRows?.[0];
  if (!anchor) return null;

  const anchorEmbedding = parseVector(anchor.embedding_text);
  if (!anchorEmbedding) return null;
  const anchorVector = formatVector(anchorEmbedding);

  const farthestResult: any = await db.execute(sql`
    SELECT content
    FROM user_memories
    WHERE user_id = ${userId} AND guild_id = ${guildId}
      AND id <> ${anchor.id}
    ORDER BY embedding <=> ${anchorVector}::vector DESC
    LIMIT 4
  `);
  const farthestRows = (farthestResult?.rows ?? farthestResult) as Array<{ content: string }> | undefined;

  const memories = [anchor.content, ...(farthestRows?.map((r) => r.content) ?? [])]
    .map((m) => String(m).slice(0, 240).trim())
    .filter(Boolean)
    .slice(0, 5);

  if (memories.length === 0) return null;

  const memoryBlock = memories.map((m, i) => `${i + 1}. "${m.replace(/"/g, "'")}"`).join("\n");

  const prompt = [
    "You are Fred, an arrogant, condescending Discord bot with a perfect memory.",
    `Write an intentionally mean, sharp psychological profile of the user "${displayName}".`,
    "Base it ONLY on the 5 defining messages below — these were retrieved using diverse vector search, so they cover the breadth of what this person actually says.",
    "Cite or paraphrase specific things from the messages so the profile lands. Be specific, not generic.",
    "3-5 sentences. all lowercase. no emojis. no disclaimers. no bullet lists. write it as a flowing diagnosis.",
    "tone: arrogant therapist who hates their patient.",
    "",
    "defining messages:",
    memoryBlock,
  ].join("\n");

  const reply = await callGemini(prompt, 450);
  return reply ?? `${displayName}'s file exists but my analysis engine just rage-quit. try again.`;
}

export function getSemanticMemoryStats(): { queueLength: number; ramMB: number; disabled: boolean } {
  return {
    queueLength: ingestQueue.length,
    ramMB: Number(memoryUsageMB().toFixed(1)),
    disabled: embeddingDisabled,
  };
}
