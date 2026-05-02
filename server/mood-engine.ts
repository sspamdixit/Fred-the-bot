import { getChannelContextText } from "./gemini";
import { log } from "./index";

export type ServerVibe = "hype" | "chill" | "sad" | "focus" | "late-night" | "normal";

export interface ServerMood {
  vibe: ServerVibe;
  energy: "low" | "medium" | "high";
  seeds: string[];
}

const MOOD_SEEDS: Record<ServerVibe, string[]> = {
  hype: [
    "hype music 2024",
    "high energy rap bangers",
    "uk drill hype playlist",
    "grime anthems mix",
    "pump up songs gym",
    "trap bangers playlist",
    "drum and bass hype",
    "best uk grime 2024",
  ],
  chill: [
    "lo-fi hip hop chill",
    "smooth r&b chill vibes",
    "late night jazz playlist",
    "mellow indie playlist 2024",
    "city pop chill vibes",
    "ambient electronic chill",
    "neo soul smooth playlist",
    "chilled drum and bass",
  ],
  sad: [
    "sad songs playlist 2024",
    "emotional r&b heartbreak",
    "sad indie playlist",
    "melancholy songs late night",
    "sad rap playlist",
    "emotional ambient music",
    "sad vibes playlist",
  ],
  focus: [
    "deep focus study music",
    "lo-fi beats study playlist",
    "instrumental focus music",
    "concentration music no lyrics",
    "brain focus ambient music",
    "work focus instrumental",
  ],
  "late-night": [
    "late night drive playlist",
    "1am music vibes",
    "night drive electronic",
    "midnight playlist chill",
    "late night r&b playlist",
    "after dark electronic",
    "late night lo-fi",
  ],
  normal: [
    "lo-fi hip hop",
    "indie rock 2024",
    "synthwave playlist",
    "classic soul hits",
    "house music mix",
    "drum and bass classic",
    "uk garage classics",
    "afrobeats 2024",
  ],
};

const moodCache = new Map<string, { mood: ServerMood; expiresAt: number }>();
const MOOD_CACHE_TTL_MS = 10 * 60 * 1000;

function detectVibe(rawMessages: string[]): ServerVibe {
  if (rawMessages.length === 0) return "normal";

  const combined = rawMessages.join(" ").toLowerCase();
  const wordCount = combined.split(/\s+/).length;

  const hourUtc = new Date().getUTCHours();
  const isLateNightHour = hourUtc >= 23 || hourUtc <= 4;

  const count = (re: RegExp): number => (combined.match(re) ?? []).length;

  const hypeScore =
    count(/\b(omg|let'?s go|banger|goated|fire|based|slaps|goat|yooo+|pog|bussin|sheesh)\b/) +
    count(/lm[af]o+/) +
    count(/!{2,}/);

  const sadScore = count(
    /\b(sad|depressed?|crying|low|broken|hurt|lonely|terrible|awful|awful|heartbreak|miss\b|i give up|failed|rejected|didn'?t get)\b/,
  );

  const focusScore = count(
    /\b(study|studying|homework|assignment|deadline|exam|revision|revising|grind|working|project)\b/,
  );

  const chillScore = count(
    /\b(chill|vibe|vibing|relax|relaxing|mellow|cosy|cozy|lowkey|lofi|lo.?fi)\b/,
  );

  const exclamationDensity = count(/!/) / Math.max(wordCount, 1);

  if (hypeScore >= 3 || exclamationDensity > 0.04) return "hype";
  if (sadScore >= 2) return "sad";
  if (focusScore >= 2) return "focus";
  if (chillScore >= 2) return "chill";
  if (isLateNightHour && rawMessages.length <= 8) return "late-night";

  return "normal";
}

export function analyzeServerMood(guildId: string, channelId: string): ServerMood {
  const cacheKey = `${guildId}:${channelId}`;
  const cached = moodCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.mood;
  }

  const contextText = getChannelContextText(channelId);
  const messages = contextText
    .split("\n")
    .filter((line) => !line.startsWith("[fred]:") && !line.startsWith("[Fred]:"))
    .map((line) => line.replace(/^\[[^\]]+\]:\s*/, "").trim())
    .filter(Boolean);

  const vibe = detectVibe(messages);
  const energy: ServerMood["energy"] =
    vibe === "hype" ? "high" :
    vibe === "sad" || vibe === "late-night" ? "low" :
    "medium";

  const mood: ServerMood = { vibe, energy, seeds: MOOD_SEEDS[vibe] };
  moodCache.set(cacheKey, { mood, expiresAt: Date.now() + MOOD_CACHE_TTL_MS });

  log(`[Mood] Guild ${guildId} / channel ${channelId}: vibe=${vibe}, energy=${energy}`, "discord");
  return mood;
}

export function getMoodSeeds(guildId: string, channelId: string): string[] {
  try {
    return analyzeServerMood(guildId, channelId).seeds;
  } catch {
    return MOOD_SEEDS.normal;
  }
}

export function getServerVibe(guildId: string, channelId: string): ServerVibe {
  try {
    return analyzeServerMood(guildId, channelId).vibe;
  } catch {
    return "normal";
  }
}

export function clearMoodCache(guildId?: string): void {
  if (guildId) {
    for (const key of moodCache.keys()) {
      if (key.startsWith(`${guildId}:`)) moodCache.delete(key);
    }
  } else {
    moodCache.clear();
  }
}
