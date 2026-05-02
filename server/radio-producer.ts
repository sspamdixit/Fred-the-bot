import { GoogleGenerativeAI } from "@google/generative-ai";
import { log } from "./index";
import { searchWeb } from "./search";

// Radio Auto-Production: Gemini generates DJ script text that Fred posts as
// Discord messages in the radio text channel. AUDIO is ALWAYS and ONLY the
// pre-recorded Lukas clips from radio_assets/. No TTS. No external voices.
// Lukas's identity is non-negotiable — this module never touches audio.

let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI | null {
  if (geminiClient) return geminiClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  geminiClient = new GoogleGenerativeAI(key);
  return geminiClient;
}

async function callGemini(prompt: string, maxOutputTokens = 80): Promise<string | null> {
  const client = getGeminiClient();
  if (!client) return null;
  for (const modelName of ["gemini-2.0-flash-lite", "gemini-2.0-flash"]) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.88, maxOutputTokens },
      });
      const result = await model.generateContent(prompt);
      const text = result?.response?.text()?.trim() ?? "";
      if (text) return text;
    } catch (err: any) {
      log(`[RadioProducer] Gemini ${modelName} failed: ${err.message}`, "radio");
    }
  }
  return null;
}

// --- Track commentary (text only, posted to Discord channel) ---

export interface TrackCommentaryContext {
  /** Up to 2 previously played tracks, oldest first. */
  prevTracks?: Array<{ artist: string; title: string }>;
  /** True when this track is the first one back after an advert break. */
  afterAdvert?: boolean;
}

export async function generateTrackCommentaryText(
  artist: string,
  title: string,
  ctx: TrackCommentaryContext = {},
): Promise<string | null> {
  const lines: string[] = [
    "You are Fred — a calm, direct Dutch AI who runs a Discord radio station called Fred FM.",
    "Write a 1-2 sentence comment about the upcoming track, as Fred would post in the radio text channel.",
    "All lowercase. No emojis. Direct and opinionated. Occasionally slip in a Dutch word naturally (ja, nee, echt, lekker, jammer, nou, prima, precies, sowieso — only when it fits).",
    "Swear only if something genuinely earns it. Do NOT start with 'i' — start with the artist name, 'next up', 'coming up', 'back with', or similar.",
  ];

  if (ctx.afterAdvert) {
    lines.push("We're returning from an advert break. Acknowledge coming back on air briefly, naturally — keep it short.");
  }

  if (ctx.prevTracks && ctx.prevTracks.length > 0) {
    const prev = ctx.prevTracks
      .map((t) => `"${t.title}" by ${t.artist}`)
      .join(", then ");
    lines.push(
      `Previously on Fred FM: ${prev}.`,
      "If there's a genuine connection to the upcoming track (same era, similar vibe, contrasting style, same artist) mention it naturally — only 1 in 3 times. Don't force it if there's no connection.",
    );
  }

  lines.push(
    `Artist: ${artist}`,
    `Track: ${title}`,
    "Output the comment text only — no labels, no quotes:",
  );

  return callGemini(lines.join("\n"), 90);
}

// --- News bulletin (text only, posted to Discord channel at top of hour) ---

export async function generateNewsText(): Promise<string | null> {
  let headlines: string[] = [];
  try {
    const searchResult = await searchWeb("top news headlines today");
    headlines = (searchResult?.results ?? [])
      .slice(0, 3)
      .map((r) => r.title?.trim() ?? "")
      .filter(Boolean);
  } catch { /* search unavailable */ }

  if (headlines.length === 0) {
    return "📻 **fred fm news** — the world is doing things. we can't confirm what those things are right now. check a reputable source.";
  }

  const prompt = [
    "You are Fred — a calm, direct Dutch AI posting a brief news bulletin in a Discord radio text channel.",
    "Write a 2-3 sentence bulletin from the headlines below. Start with '**fred fm news**'.",
    "All lowercase except the bold header. No emojis. Direct and matter-of-fact. Occasional dry observation permitted. Do NOT invent details.",
    "",
    "Headlines:",
    ...headlines.map((h, i) => `${i + 1}. ${h}`),
    "",
    "Output the bulletin text only — no labels, no quotes:",
  ].join("\n");

  const text = await callGemini(prompt, 130);
  if (!text) {
    return "📻 **fred fm news** — something happened somewhere. we're aware. moving on.";
  }
  return `📻 ${text}`;
}

// --- Listener Request Queue ---

interface RadioRequest {
  requesterName: string;
  query: string;
  requestedAt: number;
}

const requestQueues = new Map<string, RadioRequest[]>();
const MAX_REQUESTS_PER_GUILD = 5;

export function addListenerRequest(
  guildId: string,
  requesterName: string,
  query: string,
): boolean {
  const queue = requestQueues.get(guildId) ?? [];
  if (queue.length >= MAX_REQUESTS_PER_GUILD) return false;
  queue.push({ requesterName, query, requestedAt: Date.now() });
  requestQueues.set(guildId, queue);
  return true;
}

export function consumeNextRequest(guildId: string): RadioRequest | null {
  const queue = requestQueues.get(guildId);
  if (!queue || queue.length === 0) return null;
  const request = queue.shift()!;
  if (queue.length === 0) requestQueues.delete(guildId);
  return request;
}

export function getPendingRequestCount(guildId: string): number {
  return requestQueues.get(guildId)?.length ?? 0;
}
