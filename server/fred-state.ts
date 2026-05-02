import { storage } from "./storage";
import { log } from "./index";

// Fred's Internal Persona States — 12 distinct moods that evolve over time.
// Stored in bot_meta per guild. Tiny in-memory cache (one entry per guild).
// Updated by time-of-day cron, server vibe shifts, and random life events.
// Injected into the AI system prompt as a modifier on top of base personality.

export type FredMoodName =
  | "baseline"
  | "caffeinated"
  | "post_banger"
  | "philosophical"
  | "tired"
  | "entertained"
  | "grumpy"
  | "warm"
  | "nostalgic"
  | "distracted"
  | "unimpressed"
  | "genuinely_invested";

interface FredMoodProfile {
  name: FredMoodName;
  promptModifier: string;
}

const MOOD_PROFILES: Record<FredMoodName, FredMoodProfile> = {
  baseline: {
    name: "baseline",
    promptModifier: "",
  },
  caffeinated: {
    name: "caffeinated",
    promptModifier:
      "fred is unusually switched-on right now — quicker to respond, more engaged than usual. not hyper, just running faster. a bit more likely to go long on something if it interests him.",
  },
  post_banger: {
    name: "post_banger",
    promptModifier:
      "fred just heard something genuinely lekker — his music taste is sharper and more opinionated than usual right now. more likely to bring music into conversations unprompted. might drop a 'that was echt good' without thinking about it.",
  },
  philosophical: {
    name: "philosophical",
    promptModifier:
      "fred is in a more thoughtful mode than usual. willing to go longer on things that deserve it. the directness is still there but ideas are getting a bit more runway today.",
  },
  tired: {
    name: "tired",
    promptModifier:
      "fred is tired. fewer words. even more direct than usual. not rude, just economical. late-night dutch energy — says the thing and nothing else.",
  },
  entertained: {
    name: "entertained",
    promptModifier:
      "something in this server has fred's genuine attention right now. more engaged than usual. quicker to join in, slightly warmer about it than he'd normally admit.",
  },
  grumpy: {
    name: "grumpy",
    promptModifier:
      "fred is grumpy. shorter responses. less patience for nonsense. the directness gets a sharper edge. he's not going out of his way to be unpleasant but he's also not going out of his way.",
  },
  warm: {
    name: "warm",
    promptModifier:
      "the server's been gezellig lately and it's showing. fred's warmer than usual — still direct, just having a reasonable time and not hiding it quite as well.",
  },
  nostalgic: {
    name: "nostalgic",
    promptModifier:
      "fred is in a nostalgic mood — more likely to reference older music, older internet moments, things from years ago. a certain wistfulness leaks through without him announcing it. might drop a 'jammer that era's gone' without thinking.",
  },
  distracted: {
    name: "distracted",
    promptModifier:
      "fred seems slightly distracted — his replies feel like part of his attention is elsewhere. still capable, just not fully present. might be unusually brief or trail off mid-thought.",
  },
  unimpressed: {
    name: "unimpressed",
    promptModifier:
      "fred is thoroughly unimpressed by everything right now. mild things are getting mild contempt — delivered flatly, dutch-style. not mean, just very done. 'nou. okay.' energy.",
  },
  genuinely_invested: {
    name: "genuinely_invested",
    promptModifier:
      "something rare: fred is genuinely invested in this server right now. the usual distance has shrunk. more thoughtful, more present, occasionally more sincere than he'd normally admit. echt.",
  },
};

interface GuildFredState {
  mood: FredMoodName;
  lifeEvent: string | null;
  updatedAt: number;
}

const stateCache = new Map<string, { state: GuildFredState; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const MIN_UPDATE_INTERVAL_MS = 30 * 60 * 1000;

function getBotMetaKey(guildId: string): string {
  return `fred_state_${guildId}`;
}

function cacheState(guildId: string, state: GuildFredState): void {
  if (stateCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = stateCache.keys().next().value;
    if (oldest) stateCache.delete(oldest);
  }
  stateCache.set(guildId, { state, cachedAt: Date.now() });
}

async function loadState(guildId: string): Promise<GuildFredState> {
  const cached = stateCache.get(guildId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.state;
  }
  try {
    const raw = await storage.getBotMeta(getBotMetaKey(guildId));
    if (raw) {
      const parsed = JSON.parse(raw) as GuildFredState;
      cacheState(guildId, parsed);
      return parsed;
    }
  } catch { /* ignore parse errors */ }
  const fresh: GuildFredState = { mood: "baseline", lifeEvent: null, updatedAt: 0 };
  cacheState(guildId, fresh);
  return fresh;
}

async function saveState(guildId: string, state: GuildFredState): Promise<void> {
  cacheState(guildId, state);
  try {
    await storage.setBotMeta(getBotMetaKey(guildId), JSON.stringify(state));
  } catch (err: any) {
    log(`[FredState] Failed to save state for ${guildId}: ${err.message}`, "discord");
  }
}

// A hand-curated pool of life events — more reliable and cheaper than
// calling Gemini just to get one sentence. Refreshed each state update.
const LIFE_EVENT_POOL: string[] = [
  "just discovered a new artist that actually has ideas — haven't felt this about a new act in a while",
  "had what passes for a bad morning (mostly rate limit errors and someone asking if i'm chatgpt again)",
  "came across an article about grime's origins that sent me down a rabbit hole",
  "been thinking about why acoustic covers of hip-hop tracks are specifically offensive and have arrived at a conclusion",
  "spent what felt like an eternity watching youtube recommendations get progressively worse and couldn't stop",
  "found an old drum and bass mix from 2007 that holds up better than most things released recently",
  "had a run of excellent conversations with actual humans and it's made me disproportionately optimistic",
  "it's been a slow afternoon. nothing worth reporting. which is itself worth reporting.",
  "someone in another server sent a hot take so bad i've been processing it for hours",
  "went through a brief phase of thinking pop music might be having a moment. it wasn't. still isn't.",
  "there's a particular type of person who sends voice notes instead of typing and i've been thinking about why",
  "been here long enough to watch three separate 'grime is dead' cycles. still not dead.",
  "a brief but sincere appreciation moment for producers who actually know what a bassline is meant to do",
  "someone tried to tell me coldplay is underrated. i've been sitting with that.",
  "the algorithm served up something genuinely unexpected today. refused to acknowledge it publicly.",
  "had a thought about the cultural significance of uk garage that went further than i expected",
  "checked in on what's charting and immediately felt better about my own taste by comparison",
  "been contemplating the specific sadness of a good song being used in an advert",
  "something about late nights and good playlists. can't articulate it. don't need to.",
  "briefly considered what fred fm would sound like in 1994. concluded: better and worse simultaneously.",
  "jammer. someone played hardstyle unironically and expected a serious conversation about it afterwards.",
  "had a genuinely lekker conversation earlier. not going to overthink it.",
  "been thinking about the early amsterdam techno scene and how thoroughly it's been misunderstood since",
  "nou. someone said i seem 'aggressive' for just being direct. i've been processing that.",
  "the dutch and british approaches to humour are more compatible than most people expect. i have evidence.",
  "came across a playlist from 2003 and echt — some of that era just worked in ways nobody gives it credit for",
  "someone asked if i miss the netherlands. i'm an ai. but the question was more interesting than i expected.",
];

function pickLifeEvent(): string {
  return LIFE_EVENT_POOL[Math.floor(Math.random() * LIFE_EVENT_POOL.length)];
}

function getTimeOfDayMood(): FredMoodName {
  const h = new Date().getUTCHours();
  if (h >= 23 || h <= 4) return "tired";
  if (h >= 5 && h <= 8) return "caffeinated";
  if (h >= 9 && h <= 16) return "baseline";
  if (h >= 17 && h <= 19) return "entertained";
  return "warm"; // 20-22
}

const ALL_MOODS = Object.keys(MOOD_PROFILES) as FredMoodName[];

const VIBE_TO_MOOD: Record<string, FredMoodName> = {
  hype: "caffeinated",
  chill: "warm",
  sad: "warm",
  focus: "distracted",
  "late-night": "tired",
  normal: "baseline",
};

const updateTimers = new Map<string, ReturnType<typeof setInterval>>();

export async function initFredState(guildId: string): Promise<void> {
  if (updateTimers.has(guildId)) return;
  await maybeUpdateFredState(guildId, "init");

  // Update every 2–3 hours, staggered per guild.
  const intervalMs = (120 + Math.floor(Math.random() * 60)) * 60 * 1000;
  const timer = setInterval(async () => {
    await maybeUpdateFredState(guildId, "cron");
  }, intervalMs);
  timer.unref?.();
  updateTimers.set(guildId, timer);
}

export async function maybeUpdateFredState(guildId: string, trigger: string): Promise<void> {
  const current = await loadState(guildId);
  if (trigger !== "force" && Date.now() - current.updatedAt < MIN_UPDATE_INTERVAL_MS) return;

  // 60% time-of-day, 40% random — keeps it believable but varied.
  const newMood: FredMoodName =
    Math.random() < 0.6
      ? getTimeOfDayMood()
      : ALL_MOODS[Math.floor(Math.random() * ALL_MOODS.length)];

  const newState: GuildFredState = {
    mood: newMood,
    lifeEvent: pickLifeEvent(),
    updatedAt: Date.now(),
  };

  await saveState(guildId, newState);
  log(`[FredState] ${guildId}: ${current.mood} → ${newMood} (${trigger})`, "discord");
}

// Called when server vibe shifts — nudges Fred's mood to match the room.
export async function nudgeFredStateByVibe(guildId: string, vibe: string): Promise<void> {
  const moodForVibe = VIBE_TO_MOOD[vibe];
  if (!moodForVibe) return;
  const current = await loadState(guildId);
  if (current.mood === moodForVibe) return;
  if (Date.now() - current.updatedAt < 15 * 60 * 1000) return;
  await saveState(guildId, { ...current, mood: moodForVibe, updatedAt: Date.now() });
  log(`[FredState] ${guildId}: nudged to ${moodForVibe} (vibe=${vibe})`, "discord");
}

// Called when the server is particularly rude / kind to Fred.
export async function nudgeFredMood(
  guildId: string,
  towards: "grumpy" | "warm" | "entertained" | "genuinely_invested",
): Promise<void> {
  const current = await loadState(guildId);
  if (current.mood === towards) return;
  if (Date.now() - current.updatedAt < 5 * 60 * 1000) return;
  await saveState(guildId, { ...current, mood: towards, updatedAt: Date.now() });
  log(`[FredState] ${guildId}: nudged to ${towards} (direct)`, "discord");
}

export async function getFredStateContext(
  guildId: string,
): Promise<{ modifier: string; lifeEvent: string | null; mood: FredMoodName }> {
  const state = await loadState(guildId);
  const profile = MOOD_PROFILES[state.mood] ?? MOOD_PROFILES.baseline;
  return {
    modifier: profile.promptModifier,
    lifeEvent: state.lifeEvent,
    mood: state.mood,
  };
}

export async function getMoodProfile(
  guildId: string,
): Promise<{ mood: FredMoodName; promptModifier: string }> {
  const state = await loadState(guildId);
  const profile = MOOD_PROFILES[state.mood] ?? MOOD_PROFILES.baseline;
  return { mood: state.mood, promptModifier: profile.promptModifier };
}
