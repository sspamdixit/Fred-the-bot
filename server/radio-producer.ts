import { GoogleGenerativeAI } from "@google/generative-ai";
import { log } from "./index";
import { searchWeb } from "./search";

// Radio Auto-Production: generates DJ scripts via Gemini and converts them to
// StreamElements Brian TTS URLs that the radio can play directly via Lavalink.
// No files written to disk — Render-safe. All content is streamed by URL.

const STREAMELEMENTS_TTS_BASE = "https://api.streamelements.com/kappa/v2/speech";
const BRIAN_VOICE = "Brian";
const MAX_TTS_CHARS = 450;

function buildTTSUrl(text: string): string {
  const cleaned = text
    .replace(/\*+/g, "")     // strip markdown bold/italic
    .replace(/#+\s*/g, "")   // strip headers
    .replace(/\n+/g, " ")    // collapse newlines
    .trim()
    .slice(0, MAX_TTS_CHARS);
  return `${STREAMELEMENTS_TTS_BASE}?voice=${BRIAN_VOICE}&text=${encodeURIComponent(cleaned)}`;
}

let geminiClient: GoogleGenerativeAI | null = null;
function getGeminiClient(): GoogleGenerativeAI | null {
  if (geminiClient) return geminiClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  geminiClient = new GoogleGenerativeAI(key);
  return geminiClient;
}

async function callGemini(prompt: string, maxOutputTokens = 100): Promise<string | null> {
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

// --- Track Intros ---

// Pre-generated intros are stored here while the previous track plays.
// Key: guildId → TTS URL ready to consume.
const pendingIntros = new Map<string, string>();

export async function pregenerateTrackIntro(
  guildId: string,
  artist: string,
  title: string,
  vibe: string = "normal",
): Promise<void> {
  const prompt = [
    "You are writing a brief radio DJ track announcement for Fred FM — a Discord radio station hosted by a British AI called Fred.",
    "Fred is dry, sarcastic, all lowercase, no emojis, swears naturally in a british way.",
    "Write a 1-2 sentence track intro. Announce the next song and add one sharp observation about the artist or track.",
    `The server's current vibe is: ${vibe} — let that shape the energy if relevant.`,
    "Keep it under 45 words. All lowercase. No emojis. Start with 'next up', 'coming up', 'right then', or similar.",
    `Artist: ${artist}`,
    `Track: ${title}`,
    "Output the announcement text only — no labels, no quotes:",
  ].join("\n");

  const text = await callGemini(prompt, 85);
  if (text) {
    pendingIntros.set(guildId, buildTTSUrl(text));
    log(`[RadioProducer] Pre-generated intro for ${artist} — ${title}`, "radio");
  }
}

export function consumePendingIntro(guildId: string): string | null {
  const url = pendingIntros.get(guildId) ?? null;
  pendingIntros.delete(guildId);
  return url;
}

// --- Station Idents ---

const STATION_IDENTS = [
  "fred fm. still here. still broadcasting. make of that what you will.",
  "you're tuned to fred fm. the only station where the dj genuinely couldn't care less what you think.",
  "fred fm. british. opinionated. surprisingly good at this.",
  "this is fred fm. we'll be here whether you like it or not.",
  "fred fm. keeping the airwaves occupied so no one else has to.",
  "you're listening to fred fm. thank you for your continued poor decisions.",
  "fred fm. the station that plays good music even when you don't deserve it.",
  "fred fm. no requests. no apologies. no idea what we're playing next. sorted.",
  "you're on fred fm. stay as long as you like. we're not going anywhere.",
  "fred fm. quality control is loosely defined but the intent is there.",
];

export function generateStationIdentUrl(): string {
  const text = STATION_IDENTS[Math.floor(Math.random() * STATION_IDENTS.length)];
  return buildTTSUrl(text);
}

// --- News Segments (fires at top of hour) ---

export async function generateNewsSegmentUrl(): Promise<string | null> {
  let headlines: string[] = [];
  try {
    const searchResult = await searchWeb("top news headlines today");
    headlines = (searchResult?.results ?? [])
      .slice(0, 3)
      .map((r) => r.title?.trim() ?? "")
      .filter(Boolean);
  } catch { /* search unavailable */ }

  if (headlines.length === 0) {
    const fallback =
      "fred fm news. the world is doing things. we can't confirm what those things are right now. check a reputable source. that's it from the news desk.";
    return buildTTSUrl(fallback);
  }

  const prompt = [
    "You are writing a short radio news bulletin for Fred FM — a Discord radio station hosted by a British AI called Fred.",
    "Fred is dry, sarcastic, all lowercase, no emojis, naturally british, occasionally swears in a mild way.",
    "Write a 2-3 sentence news bulletin from the headlines below. Start with 'fred fm news.' Be in character.",
    "Keep it under 65 words. Dry wit permitted. Do NOT invent details — stick to what the headlines actually say.",
    "",
    "Headlines:",
    ...headlines.map((h, i) => `${i + 1}. ${h}`),
    "",
    "Output the bulletin text only — no labels, no quotes:",
  ].join("\n");

  const text = await callGemini(prompt, 130);
  if (!text) {
    return buildTTSUrl(
      "fred fm news. something happened somewhere. we're aware of it. moving on.",
    );
  }
  return buildTTSUrl(text);
}

// --- Ad-libs (generated selftalk between tracks) ---

export async function generateAdLibUrl(vibe: string = "normal"): Promise<string | null> {
  const prompt = [
    "You are writing a short DJ ad-lib for Fred FM — a Discord radio station hosted by a British AI called Fred.",
    "Fred is dry, sarcastic, all lowercase, no emojis, naturally british, occasionally swears in a mild way.",
    `The current server vibe is: ${vibe}`,
    "Write a single DJ observation, comment, or aside — between 15 and 40 words.",
    "Could be about music in general, the time of day, the nature of radio, the server's energy, or something vaguely philosophical.",
    "All lowercase. No emojis. Output the text only — no quotes, no labels:",
  ].join("\n");

  const text = await callGemini(prompt, 75);
  if (!text) return null;
  return buildTTSUrl(text);
}

// --- Listener Requests ---

interface RadioRequest {
  requesterName: string;
  query: string;
  requestedAt: number;
}

const requestQueues = new Map<string, RadioRequest[]>();

export function addListenerRequest(
  guildId: string,
  requesterName: string,
  query: string,
): boolean {
  const queue = requestQueues.get(guildId) ?? [];
  if (queue.length >= 5) return false; // cap at 5 pending requests
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

// Generate an announcement for when a listener request comes up.
export async function generateRequestAnnouncementUrl(
  requesterName: string,
  artist: string,
  title: string,
): Promise<string | null> {
  const prompt = [
    "You are writing a brief radio DJ announcement for Fred FM — a Discord radio station hosted by a British AI called Fred.",
    "Fred is dry, sarcastic, all lowercase, no emojis, british.",
    `Write a 1-sentence announcement that this track was requested by ${requesterName}.`,
    "Be mildly teasing about the request — not mean, just characteristically Fred.",
    "Keep it under 30 words. All lowercase. No emojis. Output the text only:",
    `Artist: ${artist}`,
    `Track: ${title}`,
  ].join("\n");

  const text = await callGemini(prompt, 60);
  if (!text) {
    return buildTTSUrl(
      `this one goes out to ${requesterName}. don't let it go to your head.`,
    );
  }
  return buildTTSUrl(text);
}
