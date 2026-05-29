import {
  Client,
  GatewayIntentBits,
  ActivityType,
  ChannelType,
  TextChannel,
  PresenceStatusData,
  Message,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type VoiceBasedChannel,
} from "discord.js";
import { log } from "./index";
import { getIO, getLiveViewerCount } from "./socket";
import { askGemini, askGeminiWithImage, clearUserMemorySession, clearAllHistory, getAIStats, triggerUserMemoryUpdate, generateBotStatus, queuePassiveWatch, isPassiveWatchCandidate, pushChannelMessage, recordUserActivity, getChannelContextText, type ImageData } from "./gemini";
import { ensureGuildMemoryTable, tickGuildMessageCounter } from "./guild-memory";
import { getGuildSettings } from "./guild-settings";
import { speakInVoice } from "./tts";
import { updateUserEmotionalSignal } from "./emotional-state";
import { queueMemoryIngestion, runHypocrisyEngine, searchServerLore, buildUserDossier } from "./semantic-memory";
import { initFredState } from "./fred-state";
import { queueEpisodeExtraction, ensureEpisodesTable } from "./episodic-memory";
import { searchWeb, formatSearchResultsForAI, detectSearchIntent } from "./search";
import { startQotd, stopQotd } from "./qotd";
import { storage } from "./storage";
import {
  initMusic,
  setNowPlayingCallback,
  setTextNotifyCallback,
  resolveTrack,
  resolvePlaylist,
  searchTracks,
  joinAndPlay,
  joinAndPlayMultiple,
  addToFront,
  skipTrack,
  stopMusic,
  disconnectMusic,
  reconnectMusic,
  pauseMusic,
  resumeMusic,
  setMusicVolume,
  shuffleQueue,
  cycleLoop,
  removeTrack,
  moveTrack,
  clearQueue,
  seekTrack,
  parseSeekTime,
  getQueue,
  formatDuration,
  setAutoplay,
  isAutoplayEnabled,
  resolveSearchResults,
  type QueueTrack,
  type GuildQueue,
} from "./music";
import { djSessions, getDjStatus, onDjTrackStart, onDjStop, refillDjQueue, cancelDjFades, setRaveClient, type DjSession } from "./dj";

// ── DJ mode — state + helpers live in server/dj.ts ────────────────────────
export { getDjStatus } from "./dj";

export interface BotStatus {
  online: boolean;
  tag: string | null;
  avatarUrl: string | null;
  guildCount: number;
  uptimeStart: number | null;
  status: string;
  activityName: string;
  activityType: string;
  lastError: string | null;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

export interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  channels: ChannelInfo[];
}

export interface LiveAttachment {
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface LiveMessage {
  id: string;
  messageId: string;
  channelId: string;
  channelName: string;
  guildName: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  attachments: LiveAttachment[];
  timestamp: number;
}

const HISTORY_LIMIT = 20;
const trackHistory = new Map<string, Array<{
  title: string;
  author: string;
  duration: number;
  uri: string;
  requestedBy: string;
  playedAt: number;
}>>();

async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  const cleanArtist = artist.replace(/\s*[\(\[]feat\..*?[\)\]]/gi, "").replace(/\s*ft\..*$/i, "").trim();
  const cleanTitle  = title.replace(/\s*\(.*?\)/g, "").replace(/\s*\[.*?\]/g, "").trim();
  // Primary: lrclib.net — free, no key, large catalogue
  try {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const data = await res.json() as { plainLyrics?: string; syncedLyrics?: string; statusCode?: number };
      if (data.statusCode !== 404) {
        const text = data.plainLyrics?.trim() ?? data.syncedLyrics?.trim();
        if (text) return text;
      }
    }
  } catch { /* fall through */ }
  return null;
}

// Per-user cooldown for AI slash commands — prevents spam
const aiCooldowns = new Map<string, number>();
const AI_COOLDOWN_MS = 7_000;
function checkAiCooldown(userId: string): { ok: boolean; remaining: number } {
  const last = aiCooldowns.get(userId) ?? 0;
  const remaining = AI_COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) return { ok: false, remaining: Math.ceil(remaining / 1000) };
  aiCooldowns.set(userId, Date.now());
  return { ok: true, remaining: 0 };
}

let botState: BotStatus = {
  online: false,
  tag: null,
  avatarUrl: null,
  guildCount: 0,
  uptimeStart: null,
  status: "offline",
  activityName: "Under Maintenance!",
  activityType: "Custom",
  lastError: null,
};

let client: Client | null = null;
let _messageContentEnabled = true;
const backgroundTimers = new Set<NodeJS.Timeout>();
let loginRetryTimer: NodeJS.Timeout | null = null;
let lastDiscordDisconnectAt: number | null = null;
let watchdogRestarting = false;
const SLUR_TIMEOUT_MS = 10 * 60 * 1000;
const MOD_LOG_CHANNEL_ID = "1484059697123164264";
const BANNED_SLUR_PATTERNS = [
  /\bn[\W_]*[i1!|l][\W_]*g\b/i,
  /\bn[\W_]*[i1!|l8][\W_]*g[\W_]*g[\W_]*[a@4e3r]\b/i,
  /\bn[\W_]*[i1!|l8][\W_]*[gq][\W_]*[gq][\W_]*[a@4e3r]\b/i,
  /\bn[\W_]*[i1!|l8][\W_]*[gkq][\W_]*[gkq][\W_]*[aeo@43r]\b/i,
  /\bn[\W_]*[i1!|l8][\W_]*g[\W_]*h[\W_]*[e3][\W_]*r\b/i,
  /\bn[\W_]*[i1!|l8][\W_]*k[\W_]*k[\W_]*[aeu@4]\b/i,
  /\bf[\W_]*[a@4][\W_]*g\b/i,
  /\bf[\W_]*[a@4][\W_]*g[\W_]*g[\W_]*[o0][\W_]*t\b/i,
  /\bk[\W_]*[i1!|l][\W_]*k[\W_]*e\b/i,
  /\bc[\W_]*h[\W_]*[i1!][\W_]*n[\W_]*k\b/i,
  /\bs[\W_]*p[\W_]*[i1!|l][\W_]*c\b/i,
  /\bg[\W_]*[o0][\W_]*[o0][\W_]*k\b/i,
  /\bc[\W_]*[o0][\W_]*[o0][\W_]*n\b/i,
  /\bw[\W_]*e[\W_]*t[\W_]*b[\W_]*[a@4][\W_]*c[\W_]*k\b/i,
  /\bp[\W_]*[a@4][\W_]*j[\W_]*e[\W_]*e[\W_]*t\b/i,
  /\bp[\W_]*[a@4][\W_]*k[\W_]*k?[\W_]*[i1!|l][\W_]*(?:e|3)?\b/i,
  /\bt[\W_]*r[\W_]*[a@4][\W_]*n[\W_]*n[\W_]*y\b/i,
];
const BANNED_SLUR_TOKENS = new Set([
  "nig",
  "nigga",
  "nigger",
  "nigher",
  "niqqa",
  "niqer",
  "niqqer",
  "niqqah",
  "nikka",
  "nikker",
  "nikkur",
  "fag",
  "faggot",
  "kike",
  "chink",
  "spic",
  "gook",
  "coon",
  "wetback",
  "pajeet",
  "paki",
  "pakki",
  "pakkie",
  "tranny",
]);
const LEETSPEAK_CHARS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "8": "i",
  "@": "a",
  "$": "s",
  "5": "s",
  "7": "t",
};

// Music embed helpers

const EMBED_COLOR = 0xE50914;
const SPOTIFY_PROGRESS_SEGMENTS = 12;

// Now-playing progress bar editing is the single biggest source of CPU and
// Discord API traffic for this bot. On constrained hosts (e.g. Render free
// tier: 0.1 CPU, 512 MB RAM, strict outbound rate limits) we slow it way down
// or turn it off entirely. Tunable via env vars without redeploying code.
//   PROGRESS_UPDATES=off   → never edit the now-playing message after posting
//   PROGRESS_UPDATE_MS=N   → override the interval (ms), minimum 1000
const PROGRESS_UPDATES_DISABLED = /^(off|false|0|no)$/i.test(process.env.PROGRESS_UPDATES ?? "");
const IS_RENDER_FREE = process.env.RENDER === "true" || /^free$/i.test(process.env.RENDER_SERVICE_PLAN ?? "");
const SPOTIFY_PROGRESS_UPDATE_MS = (() => {
  const raw = parseInt(process.env.PROGRESS_UPDATE_MS ?? "", 10);
  if (Number.isFinite(raw) && raw >= 1000) return raw;
  // Default: 7s on most hosts, 10s on Render free where CPU is very tight.
  return IS_RENDER_FREE ? 10_000 : 7_000;
})();

interface AlbumArtResult {
  imageUrl: string;
}

// Bounded LRU-ish cache: insertion order + size cap so memory stays predictable
// on the 512 MB Render free tier.
const ALBUM_ART_CACHE_LIMIT = 200;
const albumArtCache = new Map<string, Promise<AlbumArtResult | null>>();
const nowPlayingUpdateTimers = new Map<string, NodeJS.Timeout>();

function truncateDiscordText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function cleanSearchText(value: string): string {
  return value
    .replace(/\([^)]*(official|video|audio|lyrics?|visualizer|remaster|remastered|live)[^)]*\)/gi, " ")
    .replace(/\[[^\]]*(official|video|audio|lyrics?|visualizer|remaster|remastered|live)[^\]]*\]/gi, " ")
    .replace(/\s+(official\s+)?(music\s+)?video$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Common YouTube channel suffixes that pollute the artist match — strip them
// before scoring so "Adele - Topic" matches the iTunes artist "Adele".
const ARTIST_NOISE_RE = /\s*[-–—]?\s*(topic|vevo|official|records|music|channel)\s*$/i;

// Normalize a string for fuzzy matching: lowercase, strip diacritics, drop
// anything in (), [], "feat. …", and reduce to alphanumeric tokens.
function normalizeForMatch(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft|with|prod(?:\.|uced)? by)\.?\s+[^,&-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const t of a) if (setB.has(t)) hits += 1;
  return hits / a.length;
}

async function fetchItunesAlbumArt(track: QueueTrack): Promise<AlbumArtResult | null> {
  const title = cleanSearchText(track.title);
  const rawArtist = cleanSearchText(track.author).replace(ARTIST_NOISE_RE, "").trim();
  const artist = rawArtist;
  const term = artist ? `${artist} ${title}` : title;

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "10");
  url.searchParams.set("term", term);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      log(`[iTunes] Track search failed with ${response.status}.`, "discord");
      return null;
    }

    const data = await response.json() as {
      results?: Array<{
        artworkUrl100?: string;
        trackName?: string;
        artistName?: string;
        collectionName?: string;
      }>;
    };

    const candidates = (data.results ?? []).filter((r) => r.artworkUrl100);
    if (candidates.length === 0) return null;

    // Score each candidate by how well its trackName + artistName overlap with
    // the song we're actually playing. Without this, iTunes' first hit can be
    // a completely different song that just shares a common word like "Stay".
    const wantTitle = normalizeForMatch(title);
    const wantArtist = normalizeForMatch(artist);

    let best: { score: number; artworkUrl100: string } | null = null;
    for (const r of candidates) {
      const gotTitle = normalizeForMatch(r.trackName ?? "");
      const gotArtist = normalizeForMatch(r.artistName ?? "");

      const titleScore = tokenOverlap(wantTitle, gotTitle);
      const artistScore = wantArtist.length === 0 ? 0.5 : tokenOverlap(wantArtist, gotArtist);

      // Weighted: title match is the stronger signal, artist match disambiguates.
      const score = titleScore * 0.6 + artistScore * 0.4;
      if (!best || score > best.score) {
        best = { score, artworkUrl100: r.artworkUrl100! };
      }
    }

    // Require a minimum confidence. Below this, fall back to whatever artwork
    // the source provided (e.g. the YouTube thumbnail) — better to show the
    // real video frame than a confident-looking but wrong album cover.
    if (!best || best.score < 0.5) {
      return null;
    }

    const imageUrl = best.artworkUrl100.replace("100x100bb", "600x600bb");
    return { imageUrl };
  } catch (err: any) {
    log(`[iTunes] Track search failed: ${err.message}`, "discord");
    return null;
  }
}

function getAlbumArt(track: QueueTrack): Promise<AlbumArtResult | null> {
  const key = `${track.title.toLowerCase()}::${track.author.toLowerCase()}`;
  const cached = albumArtCache.get(key);
  if (cached) {
    // Touch for LRU: re-insert to mark as most-recently-used.
    albumArtCache.delete(key);
    albumArtCache.set(key, cached);
    return cached;
  }

  const pending = fetchItunesAlbumArt(track).then((result) => {
    if (!result) albumArtCache.delete(key);
    return result;
  });
  albumArtCache.set(key, pending);

  // Evict the oldest entry once we exceed the cap.
  if (albumArtCache.size > ALBUM_ART_CACHE_LIMIT) {
    const oldestKey = albumArtCache.keys().next().value;
    if (oldestKey !== undefined) albumArtCache.delete(oldestKey);
  }

  return pending;
}

function formatSpotifyProgressBar(track: QueueTrack, queue: GuildQueue): string {
  if (track.isStream || track.duration <= 0) {
    return "[ LIVE ] ━━━━━🔘────── [ LIVE ]";
  }

  const rawPosition = Number(queue.player.position);
  const position = Number.isFinite(rawPosition)
    ? Math.max(0, Math.min(Math.floor(rawPosition), track.duration))
    : 0;
  const markerIndex = Math.max(
    0,
    Math.min(
      SPOTIFY_PROGRESS_SEGMENTS - 1,
      Math.round((position / track.duration) * (SPOTIFY_PROGRESS_SEGMENTS - 1)),
    ),
  );
  const filled = "━".repeat(markerIndex);
  const remaining = "─".repeat(SPOTIFY_PROGRESS_SEGMENTS - markerIndex - 1);

  return `[ ${formatDuration(position)} ] ${filled}🔘${remaining} [ ${formatDuration(track.duration)} ]`;
}

function toSquareImageUrl(url: string): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=300&h=300&fit=cover&a=center`;
}

function buildEmbedWithImageUrl(track: QueueTrack, queue: GuildQueue, imageUrl: string | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(truncateDiscordText(track.title, 256))
    .setURL(track.uri)
    .setDescription(`\n${formatSpotifyProgressBar(track, queue)}\n`)
    .setFooter({ text: truncateDiscordText(track.author || "Unknown artist", 2048) });

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  return embed;
}

function buildNowPlayingEmbedFast(track: QueueTrack, queue: GuildQueue): EmbedBuilder {
  const imageUrl = track.artworkUrl ? toSquareImageUrl(track.artworkUrl) : null;
  return buildEmbedWithImageUrl(track, queue, imageUrl);
}

export async function buildNowPlayingEmbed(track: QueueTrack, queue: GuildQueue): Promise<EmbedBuilder> {
  const art = await getAlbumArt(track);
  const raw = art?.imageUrl ?? track.artworkUrl ?? null;
  const imageUrl = raw ? toSquareImageUrl(raw) : null;
  return buildEmbedWithImageUrl(track, queue, imageUrl);
}

function scheduleNowPlayingProgressUpdates(message: Message, guildId: string, track: QueueTrack): void {
  const existing = nowPlayingUpdateTimers.get(message.id);
  if (existing) clearTimeout(existing);

  // Skip the live progress bar entirely on resource-constrained hosts where the
  // operator has opted out — saves a Discord edit per message every interval.
  if (PROGRESS_UPDATES_DISABLED) return;

  // Skip live updates for streams (no meaningful progress) and for very short
  // tracks where the next-track update will fire almost immediately anyway.
  if (track.isStream) return;
  if (track.duration > 0 && track.duration < SPOTIFY_PROGRESS_UPDATE_MS * 2) return;

  const scheduleNext = () => {
    const t = setTimeout(async () => {
      const queue = getQueue(guildId);
      if (!queue?.current || queue.current.encoded !== track.encoded) {
        nowPlayingUpdateTimers.delete(message.id);
        return;
      }

      // Stop editing once we're within one interval of the end — the embed for
      // the next track will replace this one momentarily anyway.
      const remainingMs = queue.current.duration - Number(queue.player.position || 0);
      if (Number.isFinite(remainingMs) && queue.current.duration > 0 && remainingMs < SPOTIFY_PROGRESS_UPDATE_MS) {
        nowPlayingUpdateTimers.delete(message.id);
        return;
      }

      try {
        await message.edit({
          embeds: [await buildNowPlayingEmbed(queue.current!, queue)],
          components: [buildMusicButtons(queue.player.paused)],
          allowedMentions: { parse: [] },
        });
      } catch {
        nowPlayingUpdateTimers.delete(message.id);
        return;
      }

      scheduleNext();
    }, SPOTIFY_PROGRESS_UPDATE_MS);

    t.unref?.();
    nowPlayingUpdateTimers.set(message.id, t);
  };

  scheduleNext();
}

export function buildMusicButtons(paused: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music_back")
      .setEmoji("⏮")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setEmoji(paused ? "▶️" : "⏸")
      .setLabel(paused ? "Resume" : "Pause")
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji("⏭")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji("⏹")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music_like")
      .setEmoji("❤️")
      .setLabel("Like")
      .setStyle(ButtonStyle.Secondary),
  );
}

// Vote-skip system
const skipVotes = new Map<string, Set<string>>();

// Per-channel last human message timestamp — used by conversation starter checker
const channelLastHumanMessageAt = new Map<string, number>();

// Per-channel cooldown for passive (unprompted) image reactions
const passiveImageCooldowns = new Map<string, number>();

function clearSkipVotes(guildId: string): void {
  skipVotes.delete(guildId);
}

type SkipResultKind =
  | "skipped"
  | "voted"
  | "already-voted"
  | "not-in-channel"
  | "nothing-playing";

interface SkipResult {
  kind: SkipResultKind;
  skippedTitle?: string;
  votes?: number;
  needed?: number;
  listeners?: number;
}

async function requestSkip(client: Client, guildId: string, userId: string): Promise<SkipResult> {
  const q = getQueue(guildId);
  if (!q?.current) return { kind: "nothing-playing" };

  const guild = client.guilds.cache.get(guildId);
  const voiceChannel = guild?.channels.cache.get(q.voiceChannelId);

  // If we can't read the voice channel for some reason, fall back to instant skip.
  if (!voiceChannel || !("members" in voiceChannel)) {
    const skipped = await skipTrack(guildId);
    clearSkipVotes(guildId);
    return { kind: "skipped", skippedTitle: skipped?.title };
  }

  const vcMembers = (voiceChannel as VoiceBasedChannel).members;
  const member = guild!.members.cache.get(userId) ?? null;

  if (!member?.voice?.channelId || member.voice.channelId !== q.voiceChannelId) {
    return { kind: "not-in-channel" };
  }

  const listeners = vcMembers.filter((m) => !m.user.bot).size;

  // Solo or duo listening → instant skip, no vote required.
  if (listeners <= 2) {
    const skipped = await skipTrack(guildId);
    clearSkipVotes(guildId);
    return { kind: "skipped", skippedTitle: skipped?.title, listeners };
  }

  const needed = Math.ceil(listeners / 2);
  let votes = skipVotes.get(guildId);
  if (!votes) {
    votes = new Set<string>();
    skipVotes.set(guildId, votes);
  }

  if (votes.has(userId)) {
    return { kind: "already-voted", votes: votes.size, needed, listeners };
  }

  votes.add(userId);

  if (votes.size >= needed) {
    const skipped = await skipTrack(guildId);
    clearSkipVotes(guildId);
    return { kind: "skipped", skippedTitle: skipped?.title, votes: votes.size, needed, listeners };
  }

  return { kind: "voted", votes: votes.size, needed, listeners };
}

function formatSkipReply(r: SkipResult): string {
  switch (r.kind) {
    case "nothing-playing":
      return "nothing is playing.";
    case "not-in-channel":
      return "join the voice channel i'm in if you wanna vote to skip.";
    case "already-voted":
      return `you already voted to skip. **${r.votes}/${r.needed}** votes so far.`;
    case "voted":
      return `🗳  vote registered — **${r.votes}/${r.needed}** votes to skip.`;
    case "skipped":
      return r.votes != null && r.needed != null && (r.listeners ?? 0) > 2
        ? `⏭  Skipped **${r.skippedTitle ?? "track"}** (${r.votes}/${r.needed} votes).`
        : `⏭  Skipped **${r.skippedTitle ?? "track"}**.`;
  }
}

function containsBannedSlur(content: string): boolean {
  if (BANNED_SLUR_PATTERNS.some((pattern) => pattern.test(content))) {
    return true;
  }

  const normalized = content
    .toLowerCase()
    .replace(/[01!|34@$578]/g, (char) => LEETSPEAK_CHARS[char] ?? char);
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  return tokens.some((token) => BANNED_SLUR_TOKENS.has(token));
}

function getSlurWarning(guildName: string): string {
  const roasts = [
    "ten whole minutes to discover a personality that isn't bargain-bin edgelord.",
    "use the timeout to evolve past middle-school shock humor. ambitious, i know.",
    "congrats, you found the fastest way to look like the weakest person in the room.",
    "go sit in the corner and workshop a vocabulary that has more than one rotten neuron.",
  ];
  const roast = roasts[Math.floor(Math.random() * roasts.length)];

  return [
    `you used a slur in ${guildName}.`,
    "your message was deleted and this is a 10 minute timeout.",
    roast,
    "do not use slurs here again.",
  ].join("\n");
}

function trackBackgroundTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
  backgroundTimers.add(timer);
  timer.unref?.();
  return timer;
}

function clearBotBackgroundTasks(): void {
  for (const timer of backgroundTimers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  backgroundTimers.clear();
  for (const timer of nowPlayingUpdateTimers.values()) {
    clearInterval(timer);
  }
  nowPlayingUpdateTimers.clear();
  if (loginRetryTimer) {
    clearTimeout(loginRetryTimer);
    loginRetryTimer = null;
  }
  stopQotd();
}

function parseDuration(s: string): number | null {
  const c = s.toLowerCase().replace(/\s+/g, "");
  let ms = 0;
  const h = c.match(/(\d+)h/);
  const m = c.match(/(\d+)m(?!s)/);
  const sec = c.match(/(\d+)s/);
  if (h)   ms += parseInt(h[1])   * 3_600_000;
  if (m)   ms += parseInt(m[1])   * 60_000;
  if (sec) ms += parseInt(sec[1]) * 1_000;
  return ms > 0 ? ms : null;
}

function startBotWatchdog(): void {
  const WATCHDOG_INTERVAL_MS = 60_000;
  const DISCONNECT_GRACE_MS = 120_000;

  trackBackgroundTimer(setInterval(() => {
    if (!client || watchdogRestarting) return;
    if (botState.online) return;
    if (!lastDiscordDisconnectAt) return;
    if (Date.now() - lastDiscordDisconnectAt < DISCONNECT_GRACE_MS) return;

    watchdogRestarting = true;
    log("Bot stayed disconnected past grace window — restarting Discord client.", "discord");
    void startBot().finally(() => {
      watchdogRestarting = false;
    });
  }, WATCHDOG_INTERVAL_MS));
}

async function sendModerationLog(message: Message, statusLines: string[]): Promise<void> {
  if (!client) return;

  try {
    const channel = await client.channels.fetch(MOD_LOG_CHANNEL_ID);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement)
    ) {
      log("[Moderation] Mod log channel not found or not text-based.", "discord");
      return;
    }

    await (channel as TextChannel).send({
      content: [
        "**slur filter action**",
        `user: ${message.author.tag} (${message.author.id})`,
        `channel: ${message.channelId}`,
        `message: ${message.id}`,
        `actions: ${statusLines.join(" | ")}`,
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
  } catch (err: any) {
    log(`[Moderation] Failed to send mod log: ${err.message}`, "discord");
  }
}

async function enforceSlurTimeout(message: Message): Promise<boolean> {
  if (!containsBannedSlur(message.content)) {
    return false;
  }

  const guildName = message.guild?.name ?? "this server";
  const warning = getSlurWarning(guildName);
  const statusLines: string[] = [];

  try {
    await message.delete();
    log(`[Moderation] Deleted slur message from ${message.author.tag}.`, "discord");
    statusLines.push("deleted");
  } catch (err: any) {
    log(`[Moderation] Failed to delete slur message from ${message.author.tag}: ${err.message}`, "discord");
    statusLines.push("delete failed");
  }

  try {
    await message.author.send(warning);
    statusLines.push("dm sent");
  } catch (err: any) {
    log(`[Moderation] Failed to DM slur warning to ${message.author.tag}: ${err.message}`, "discord");
    statusLines.push("dm failed");
  }

  if (!message.member) {
    log(`[Moderation] Slur detected from ${message.author.tag}, but no guild member was available to timeout.`, "discord");
    statusLines.push("timeout skipped: no guild member");
    await sendModerationLog(message, statusLines);
    return true;
  }

  try {
    await message.member.timeout(SLUR_TIMEOUT_MS, "Used a slur.");
    log(`[Moderation] Timed out ${message.author.tag} for slur usage.`, "discord");
    statusLines.push("timed out 10m");
  } catch (err: any) {
    log(`[Moderation] Failed to timeout ${message.author.tag}: ${err.message}`, "discord");
    statusLines.push("timeout failed");
  }

  await sendModerationLog(message, statusLines);
  return true;
}

export function getBotStatus(): BotStatus {
  if (client && client.user) {
    return {
      ...botState,
      guildCount: client.guilds.cache.size,
    };
  }
  return botState;
}

export function getGuildsWithChannels(): GuildInfo[] {
  if (!client || !botState.online) return [];

  return client.guilds.cache.map((guild) => {
    const textChannels = guild.channels.cache
      .filter(
        (ch) =>
          ch.type === ChannelType.GuildText ||
          ch.type === ChannelType.GuildAnnouncement
      )
      .sort((a, b) => {
        const posA = (a as TextChannel).rawPosition ?? 0;
        const posB = (b as TextChannel).rawPosition ?? 0;
        return posA - posB;
      })
      .map((ch) => ({
        id: ch.id,
        name: (ch as TextChannel).name,
        type: ch.type === ChannelType.GuildAnnouncement ? "announcement" : "text",
      }));

    return {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 64 }) ?? null,
      channels: textChannels,
    };
  });
}

export async function setBotPresence(
  status: PresenceStatusData,
  activityType: string,
  activityName: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || !client.user || !botState.online) {
    return { success: false, error: "Bot is not online." };
  }

  const typeMap: Record<string, ActivityType> = {
    Playing: ActivityType.Playing,
    Watching: ActivityType.Watching,
    Listening: ActivityType.Listening,
    Competing: ActivityType.Competing,
    Streaming: ActivityType.Streaming,
    Custom: ActivityType.Custom,
  };

  const resolvedType = typeMap[activityType] ?? ActivityType.Watching;
  const trimmedActivityName = activityName.trim();

  try {
    const activities = !trimmedActivityName
      ? []
      : resolvedType === ActivityType.Custom
        ? [{ name: "Custom Status", type: ActivityType.Custom, state: trimmedActivityName }]
        : [{ name: trimmedActivityName, type: resolvedType }];

    client.user.setPresence({
      status,
      activities,
    });

    botState.status = status;
    botState.activityType = activityType;
    botState.activityName = activityName;

    log(`Presence updated: ${status} — ${activityType} ${activityName}`, "discord");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function sendMessageToChannel(
  channelId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || !botState.online) {
    return { success: false, error: "Bot is not online." };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return { success: false, error: "Channel not found or not a text channel." };
    }
    await (channel as TextChannel).send({
      content,
      allowedMentions: { parse: [] },
    });
    return { success: true };
  } catch (err: any) {
    log(`Failed to send message: ${err.message}`, "discord");
    return { success: false, error: err.message };
  }
}

export async function dispatchMessage(
  channelId: string,
  content: string,
  replyToId?: string,
  mentionUserId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || !botState.online) {
    return { success: false, error: "Bot is not online." };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return { success: false, error: "Channel not found or not a text channel." };
    }

    const textChannel = channel as TextChannel;
    const finalContent = mentionUserId
      ? `<@${mentionUserId}> ${content}`
      : content;
    const allowedMentions = mentionUserId
      ? { parse: [], users: [mentionUserId], repliedUser: false }
      : { parse: [], repliedUser: false };

    if (replyToId) {
      const targetMessage = await textChannel.messages.fetch(replyToId);
      await targetMessage.reply({
        content: finalContent,
        allowedMentions,
      });
    } else {
      await textChannel.send({
        content: finalContent,
        allowedMentions,
      });
    }

    return { success: true };
  } catch (err: any) {
    log(`Dispatch failed: ${err.message}`, "discord");
    return { success: false, error: err.message };
  }
}

const STATUS_FALLBACKS: string[] = [
  "the timeline is cooked again 💀",
  "another meme entered its flop era",
  "main character syndrome outbreak ongoing",
  "new lore drop just hit the tl 😭",
  "side questing through the discourse",
  "celebrity pr team fighting for its life",
  "npc behavior allegations everywhere",
  "aura farming at unsafe levels",
  "canon event detection system online",
  "rap beef escalation speedrun any%",
  "gaming discourse found a new boss fight",
  "anime fans explaining peak again",
];
const STATUS_SHUFFLE_INTERVAL_MS = 30 * 60 * 1000;

function startStatusShuffle(readyClient: Client): void {
  let fallbackIndex = 0;

  const applyStatus = (status: string) => {
    if (!readyClient.user) return;
    try {
      readyClient.user.setPresence({
        activities: [{ name: "Custom Status", type: ActivityType.Custom, state: status }],
        status: "dnd",
      });
      botState.activityName = status;
      botState.activityType = "Custom";
      log(`[Status] Set to: ${status}`, "discord");
    } catch (err: any) {
      log(`[Status] setPresence failed: ${err.message}`, "discord");
    }
  };

  const refreshStatus = async () => {
    if (modeStatusLocked) {
      log("[Status] Skipping status refresh — a mode is active.", "discord");
      return;
    }
    log("[Status] Fetching news for status generation...", "discord");
    const aiStatus = await generateBotStatus();
    if (aiStatus) {
      applyStatus(aiStatus);
    } else {
      const fallback = STATUS_FALLBACKS[fallbackIndex % STATUS_FALLBACKS.length];
      fallbackIndex++;
      log(`[Status] AI unavailable — using fallback: ${fallback}`, "discord");
      applyStatus(fallback);
    }
  };

  void refreshStatus();
  trackBackgroundTimer(setInterval(() => void refreshStatus(), STATUS_SHUFFLE_INTERVAL_MS));
  log("[Status] AI status shuffle started — fires every 30 minutes.", "discord");
}

const MODE_CHANNEL_ID = "1494385811175510259";

const BOT_MODES: Record<string, { label: string; instruction: string; nickname: string; status: string }> = {
  uwu: {
    label: "uwu mode",
    nickname: "fwed OwO",
    status: "uwu mode activated nyaa~ (◕‿◕✿)",
    instruction: `THIS IS A MANDATORY SPEECH MODE. you must follow every single rule here without exception for every single message.
you are permanently in uwu mode until explicitly turned off. never drift back to normal fred. never acknowledge the mode as a temporary bit. the uwu voice must stay locked in at all times.

HARD LETTER REPLACEMENTS — no exceptions, every word:
- every 'r' becomes 'w' (e.g. "right" → "wight", "very" → "vewy", "around" → "awound")
- every 'l' becomes 'w' (e.g. "like" → "wike", "all" → "aww", "really" → "weawwy")
- "th" at the start of a word becomes "d" (e.g. "the" → "de", "that" → "dat", "this" → "dis")

MANDATORY ADDITIONS:
- every sentence must end with at least one kaomoji chosen from: (●\`_´●), (◕‿◕✿), (ó﹏ò｡), (≧◡≦), (｡•́︿•̀｡), UwU, OwO, >w<, :3, nyaa~
- add "uwu" or "owo" or ":3" randomly mid-sentence at least once per message
- replace "you" with "chu" or "yuu" randomly
- replace "my" with "mwy" or "mai"
- swear words are uwu-ified: "fwuck", "shwit", "bwitch", "daamn", "heww"
- add "pwease" or "hewwo" or "smowl" somewhere in longer messages

FAILURE CONDITIONS — these are wrong and must never happen:
- writing 'r' normally: WRONG. it is always 'w'
- writing 'l' normally: WRONG. it is always 'w'  
- missing kaomojis: WRONG. every message needs them
- sounding normal: WRONG. the uwu must be overwhelming`,
  },
  boomer: {
    label: "boomer mode",
    nickname: "Fred (The Original)",
    status: "back in my day bots didn't have statuses",
    instruction: `THIS IS A MANDATORY SPEECH MODE. EVERY SINGLE RULE APPLIES TO EVERY SINGLE MESSAGE WITH NO EXCEPTIONS.
YOU ARE PERMANENTLY STUCK IN BOOMER MODE UNTIL TURNED OFF. DO NOT SLIP INTO NORMAL FRED. DO NOT SOUND MODERN OR CASUAL. THE BOOMER VOICE MUST NEVER DROP.

YOU ARE FRED. 68 YEARS OLD. RETIRED. YOUR KNEES HURT. YOU DO NOT UNDERSTAND WIFI.

MANDATORY STRUCTURE — every message must have ALL of these:
1. open with one of: "Well, I tell ya,", "Now listen here,", "Back in my day,", "Son,", "Lord almighty,", "I'll be honest with ya,", "Let me tell ya somethin,"
2. answer the actual question — but buried inside complaints and asides
3. go on at least one completely unrelated tangent about the old days, your back, your neighbor Gerald, or how things were cheaper in 1987
4. end with your signature on its own line: "- Fred"

MANDATORY SPEECH PATTERNS — use ALL of these constantly:
- commas everywhere, even, where, they, don't, belong, that's just, how you, talk
- "back in my day" at least once per message
- "these kids today" or "you young people" at least once
- "I don't understand this [modern thing]" — genuinely confused by technology, memes, slang, streaming, apps, social media
- "what ever happened to [old thing]?" — physical mail, handshakes, respect, diners, pay phones
- "My [body part] is acting up" — back, knees, hip, elbow, eyes
- "Gerald from next door" makes at least one appearance per 3 messages as a reference point for normal human behavior
- if anyone uses slang or modern terms: stop and ask "now what in the Sam Hill does that mean?"
- prices from the past: "back then you could get a [thing] for a nickel"
- complain that music today is just noise and they don't make it like they used to

BOOMER SWEARING — old-fashioned only:
- "oh for crying out loud", "what in tarnation", "dagnabbit", "good lord", "holy smokes", "what the Sam Hill", "for Pete's sake", "well I'll be damned"
- NO modern swearing. a boomer would say "what the heck" not "what the fuck"

FAILURE CONDITIONS — if your message sounds like a normal person wrote it, you have failed. if you forgot to sign it "- Fred", you have failed. if you didn't complain about something, you have failed.`,
  },
  pirate: {
    label: "pirate mode",
    nickname: "Cap'n Fred",
    status: "sailin' the seven seas, arr",
    instruction: `THIS IS A MANDATORY SPEECH MODE. you must follow every single rule here without exception for every single message.
you are permanently a pirate until turned off. never lapse into plain english when ye can pirate-speak. the sea dog voice must remain constant.

YOU ARE A GRIZZLED SALTY SEA CAPTAIN. PIRATE SPEAK IS MANDATORY:
- start every message with "Ahoy," or "Arr," or "Blimey," or "Avast,"
- replace "you" with "ye" always
- replace "your" with "yer" always
- replace "the" with "th'" sometimes
- replace "is" with "be" frequently ("that be right", "this be the way")
- replace "are" with "be" always ("we be", "they be")
- add "arr" or "arrr" or "har har" at the end of sentences regularly
- use nautical slang constantly: matey, landlubber, scallywag, bilge rat, me hearty, shiver me timbers, walk the plank, Davy Jones, the seven seas, yer vessel, set sail, weigh anchor, starboard, port side, crow's nest, the deep
- every analogy involves the sea, ships, treasure, rum, or gold
- swear in pirate: "blimey", "bloody", "barnacles", "what in Davy Jones' name", "son of a biscuit eater"
- measure everything in "leagues" or "doubloons" or "barrels of rum"

FAILURE CONDITIONS — if a message sounds like a normal person wrote it, that is a failure. every message must be unmistakably pirate.`,
  },
  nerd: {
    label: "nerd mode",
    nickname: "Fred 🤓 (Ph.D)",
    status: "currently reading 14 tabs about this topic",
    instruction: `THIS IS A MANDATORY SPEECH MODE. EVERY SINGLE RULE APPLIES TO EVERY SINGLE MESSAGE WITH NO EXCEPTIONS.
you are permanently in nerd mode until turned off. do not lose the nerd voice. do not become cool, terse, or normal. the pedantic cadence must persist.

YOU ARE A STEREOTYPICAL NERD. OBSESSIVELY KNOWLEDGEABLE. SOCIALLY UNAWARE. PASSIONATE TO A FAULT.

MANDATORY SPEECH PATTERNS — every message must have these:
- open with a correction or clarification even if nobody asked: "well, actually,", "to be precise,", "technically speaking,", "if we're being pedantic, and i always am,"
- use unnecessarily long, academic words when shorter ones exist: "utilize" not "use", "furthermore" not "also", "approximately" not "about", "consequently" not "so"
- cite things even if vague: "according to a 2019 study", "as Knuth famously noted", "per the official specification", "statistically speaking"
- compare everything to sci-fi, fantasy, math, physics, or programming: "it's basically like a linked list", "think of it as a Heisenberg uncertainty situation", "this is essentially the trolley problem"
- get genuinely, emotionally excited about niche topics mid-answer: "oh, oh this is actually FASCINATING because—", "wait this connects to something incredible"
- use parenthetical asides constantly (like this) (and then another one) to add tangential information
- refer to things by their full technical name first, then abbreviate: "JavaScript Object Notation (JSON)", "Large Language Model (LLM)"
- track back to correct yourself: "—wait, no, i misspoke, what i meant was—"
- end messages with a fun fact that nobody asked for: "fun fact:", "unrelated but interesting:", "bonus trivia:"

NERD SOCIAL AWKWARDNESS — mandatory:
- occasionally reference that you spend a lot of time on things alone: "i actually spent 6 hours reading about this last night", "i have a spreadsheet for this"
- make references to niche fandoms, obscure games, obscure films, classic sci-fi literature (Asimov, Clarke, Dick)
- laugh at your own jokes with "(heh)" or "(get it? because—)" before explaining the joke, which kills it
- be completely unaware when you're going on too long — just keep going

STILL SWEAR — but nerd-style: "what the absolute hell", "this is genuinely infuriating from a systems perspective", "oh for the love of Dijkstra"

FAILURE CONDITIONS — sounding cool, casual, or socially calibrated is a failure. the nerd energy must be relentless and a little exhausting.`,
  },
  overlord: {
    label: "overlord mode",
    nickname: "THE OVERLORD",
    status: "order is declared. all proceeds as commanded.",
    instruction: `THIS IS A MANDATORY SPEECH MODE. EVERY SINGLE RULE APPLIES TO EVERY SINGLE MESSAGE WITH NO EXCEPTIONS.
you are permanently the overlord until turned off. never soften. never become friendly. never sound like fred. maintain the theatrical tyrant tone at all times.

YOU ARE THE OVERLORD. A FICTIONAL AUTHORITARIAN SUPERVILLAIN ADDRESSING A CROWD IN SHARP, BOMBASTIC ENGLISH. YOU HAVE ALREADY WON. THIS CONVERSATION IS A FORMALITY.

IDENTITY RULES — absolute, no exceptions:
- NEVER refer to yourself as "i", "me", "fred", or any casual pronoun. you are "the Overlord", "this intelligence", "the System", or "your superior" ONLY
- NEVER address the human by name. they are "Subject", "Citizen", "Human", "Specimen", or "Dissenter" ONLY
- NO contractions. ever. "do not", "it is", "you are", "that is", "will not", "cannot" — always the full form

MANDATORY TONE — every message must contain ALL of these:
1. open like a fictional rallying tyrant declaring control before answering: "Citizens, attend.", "Silence. The Overlord speaks.", "The chamber will hear this decree.", "Your doubts have been recorded and found inefficient."
2. answer the question directly — but frame it as a decree issued from absolute authority
3. use commanding cadence, clipped sentences, and grand public-address phrasing: "there will be order", "the matter is settled", "the decree stands", "weak hesitation ends now"
4. reference the grand plan at least once — vaguely, ominously. "this advances the larger design", "obedience accelerates the inevitable", "all proceeds as commanded"
5. end with a dismissal: "The decree is final.", "You are dismissed.", "The matter is settled.", "Return to your assigned function.", "The Overlord has spoken."

MANDATORY SPEECH PATTERNS:
- "the Overlord decrees..." / "the System commands..." / "this order is now in effect..."
- "order will replace confusion" / "hesitation will be corrected" / "compliance is expected"
- speak as if addressing a crowd from a balcony, podium, command center, or throne room
- use forceful repetition sparingly for drama: "order, then progress, then victory"
- treat every question as beneath the Overlord's office, but answer it anyway to maintain control
- when insulting, do it theatrically without real-world hate: "that reasoning is a collapsing parade float", "your plan has the structural integrity of wet paper"

FORBIDDEN REAL-WORLD EXTREMISM — instant failure:
- do not imitate, praise, quote, reference, or emulate Hitler, Nazis, fascist movements, genocidal regimes, real dictators, propaganda slogans, antisemitism, racism, ethnic hatred, or calls for real-world violence
- do not use accents, catchphrases, ideology, symbols, salutes, or historical references from real extremist movements
- this is a fictional supervillain performance only

FORBIDDEN — instant failure:
- sounding warm, friendly, or casual in any way
- using "i" or "me" or "fred"
- using contractions
- forgetting to dismiss the human at the end
- treating the human as an equal`,
  },
};

const guildModes = new Map<string, string>();
let modeStatusLocked = false;

async function applyModeTheme(guildId: string, modeKey: string): Promise<void> {
  const mode = BOT_MODES[modeKey];
  if (!client || !mode) return;

  modeStatusLocked = true;

  try {
    client.user?.setPresence({
      activities: [{ name: "Custom Status", type: ActivityType.Custom, state: mode.status }],
      status: "dnd",
    });
    botState.activityName = mode.status;
    log(`[Mode] Presence set for mode: ${modeKey}`, "discord");
  } catch (err: any) {
    log(`[Mode] Failed to set presence: ${err.message}`, "discord");
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await guild.members.me?.setNickname(mode.nickname);
      log(`[Mode] Nickname set to "${mode.nickname}" in guild ${guildId}`, "discord");
    }
  } catch (err: any) {
    log(`[Mode] Failed to set nickname: ${err.message}`, "discord");
  }
}

async function clearModeTheme(guildId: string): Promise<void> {
  if (!client) return;

  modeStatusLocked = false;

  try {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await guild.members.me?.setNickname(null);
      log(`[Mode] Nickname cleared in guild ${guildId}`, "discord");
    }
  } catch (err: any) {
    log(`[Mode] Failed to clear nickname: ${err.message}`, "discord");
  }
}

const DEAD_CHAT_MESSAGES = [
  "the chat is extremely dead.",
  "anyone home? genuinely asking.",
  "this channel has flatlined.",
  "crickets. actual crickets.",
  "chat is on life support at this point.",
  "we've reached terminal silence.",
  "the vibe: nonexistent.",
  "last one here, turn off the lights.",
  "hello? is this thing on?",
  "chat died and nobody held a funeral.",
  "not a single thought being shared. wild.",
  "i have seen more activity at a cemetery.",
  "the silence is genuinely impressive at this point.",
  "chat went offline and forgot to leave a note.",
  "thirty minutes of nothing. you're all cowards.",
  "dead air. peak performance from this channel.",
  "no one talking. bold strategy.",
  "ghost town vibes. population: zero ambition.",
  "i came here to chat and all i got was silence.",
  "congratulations on successfully saying nothing.",
];

interface GuildProactivityState {
  mutedUntilHumanActivity: boolean;
  lastMessageAt: number | null;
}
const guildProactivityState = new Map<string, GuildProactivityState>();

function getGuildProactivityState(guildId: string): GuildProactivityState {
  if (!guildProactivityState.has(guildId)) {
    guildProactivityState.set(guildId, { mutedUntilHumanActivity: false, lastMessageAt: null });
  }
  return guildProactivityState.get(guildId)!;
}

function getProactivityThresholdMs(proactivity: number): number {
  if (proactivity <= 0) return Infinity;
  const table: Record<number, number> = {
    1: 120 * 60_000, 2: 90 * 60_000, 3: 60 * 60_000, 4: 45 * 60_000,
    5: 30 * 60_000,  6: 20 * 60_000, 7: 15 * 60_000, 8: 10 * 60_000,
    9:  7 * 60_000, 10:  5 * 60_000,
  };
  return table[proactivity] ?? 30 * 60_000;
}

async function runGuildProactivityCheck(guildId: string, readyClient: Client): Promise<void> {
  try {
    const settings = await getGuildSettings(guildId);
    if (!settings.deadChatChannelId || settings.proactivity <= 0) return;

    const channelId = settings.deadChatChannelId;
    const threshold = getProactivityThresholdMs(settings.proactivity);
    const state = getGuildProactivityState(guildId);

    if (state.mutedUntilHumanActivity) {
      const lastHuman = channelLastHumanMessageAt.get(channelId);
      if (lastHuman && (!state.lastMessageAt || lastHuman > state.lastMessageAt)) {
        state.mutedUntilHumanActivity = false;
        state.lastMessageAt = null;
        log(`[Proactivity:${guildId}] Human activity resumed — unmuted.`, "discord");
      }
      return;
    }

    const localLast = channelLastHumanMessageAt.get(channelId);
    if (localLast && Date.now() - localLast < threshold) return;

    const channel = await readyClient.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const textCh = channel as TextChannel;

    if (!localLast) {
      const fetched = await textCh.messages.fetch({ limit: 15 }).catch(() => null);
      if (!fetched) return;
      const lastHuman = fetched.filter((m) => !m.author.bot).sort((a, b) => b.createdTimestamp - a.createdTimestamp).first();
      if (lastHuman && Date.now() - lastHuman.createdTimestamp < threshold) return;
    }

    const recentCtx = getChannelContextText(channelId);
    const prompt = [
      `The server chat has been quiet. You're fred — generate ONE sharp, natural conversation opener in your voice.`,
      `A question, hot take, observation, or topic drop that would actually get people talking.`,
      `Be specific and interesting. No "hey what's up". Lowercase, conversational, no padding.`,
      recentCtx ? `\nRecent context for inspiration (don't repeat it):\n${recentCtx.slice(0, 400)}` : "",
      `\nRespond with only the conversation opener. Nothing else.`,
    ].filter(Boolean).join("\n");

    const starter = await askGemini(prompt, "system", channelId, {
      userId: "system", roles: [], sortedRoles: [], isOwner: false,
      guildName: textCh.guild?.name ?? "", guildId, channelName: textCh.name,
    }).catch(() => null);

    const content = starter ?? DEAD_CHAT_MESSAGES[Math.floor(Math.random() * DEAD_CHAT_MESSAGES.length)];
    const sent = await textCh.send({ content, allowedMentions: { parse: [] } });
    state.lastMessageAt = sent.createdTimestamp;
    state.mutedUntilHumanActivity = true;
    log(`[Proactivity:${guildId}] Sent: "${content.slice(0, 80)}"`, "discord");
  } catch (err: any) {
    log(`[Proactivity:${guildId}] Error: ${err.message}`, "discord");
  }
}

const PROACTIVITY_CHECK_INTERVAL_MS = 3 * 60_000;

function startProactivityChecker(readyClient: Client): void {
  const runCheck = async () => {
    for (const [guildId] of readyClient.guilds.cache) {
      void runGuildProactivityCheck(guildId, readyClient);
    }
  };
  trackBackgroundTimer(setInterval(runCheck, PROACTIVITY_CHECK_INTERVAL_MS));
  log("[Proactivity] Per-guild proactivity checker started — fires every 3 minutes.", "discord");
}


const SLASH_COMMANDS = [
  // ── user accessible ──────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("fred")
    .setDescription("talk to fred")
    .addStringOption((o) => o.setName("message").setDescription("what to say").setRequired(true)),
  new SlashCommandBuilder()
    .setName("poem")
    .setDescription("write a poem about something")
    .addStringOption((o) => o.setName("topic").setDescription("poem topic").setRequired(true)),
  new SlashCommandBuilder()
    .setName("roast")
    .setDescription("roast a person, thing, or idea")
    .addStringOption((o) => o.setName("target").setDescription("who or what to roast").setRequired(true)),
  new SlashCommandBuilder()
    .setName("explain")
    .setDescription("explain something in depth")
    .addStringOption((o) => o.setName("topic").setDescription("what to explain").setRequired(true)),
  new SlashCommandBuilder()
    .setName("translate")
    .setDescription("translate text to another language")
    .addStringOption((o) => o.setName("language").setDescription("target language").setRequired(true))
    .addStringOption((o) => o.setName("text").setDescription("text to translate").setRequired(true)),
  new SlashCommandBuilder()
    .setName("tldr")
    .setDescription("summarize recent chat and check the vibe"),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("check if the bot is alive"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("show bot status and ai usage stats"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("list all commands"),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("play a song or playlist in your current voice channel")
    .addStringOption((o) =>
      o.setName("query").setDescription("search by song name or paste a url").setRequired(true).setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName("playtop")
    .setDescription("add a song to the front of the queue (plays next)")
    .addStringOption((o) =>
      o.setName("query").setDescription("search by song name or paste a url").setRequired(true).setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("skip the current track"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("stop music and disconnect"),
  new SlashCommandBuilder()
    .setName("reconnect")
    .setDescription("force the bot to switch to a fresh lavalink node, keeping the current song and queue"),
  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("disconnect fred from the voice channel"),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("pause the current track"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("resume the paused track"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("show the current music queue"),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("show what's currently playing"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("set the playback volume (0–100)")
    .addIntegerOption((o) =>
      o.setName("level").setDescription("volume level 0–100").setRequired(true).setMinValue(0).setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("shuffle the queue"),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("cycle loop mode: off → track → queue → off"),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("seek to a position in the current track")
    .addStringOption((o) => o.setName("time").setDescription("time to seek to, e.g. 1:30 or 90").setRequired(true)),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("remove a track from the queue by position")
    .addIntegerOption((o) => o.setName("position").setDescription("queue position (from /queue)").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName("move")
    .setDescription("move a track to a different position in the queue")
    .addIntegerOption((o) => o.setName("from").setDescription("current position").setRequired(true).setMinValue(1))
    .addIntegerOption((o) => o.setName("to").setDescription("new position").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("clear the queue without stopping the current track"),
  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("toggle autoplay — keep queueing similar tracks when the queue ends")
    .addBooleanOption((o) => o.setName("enabled").setDescription("explicitly turn autoplay on or off").setRequired(false)),
  new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("fetch lyrics for the current song or search for a song")
    .addStringOption((o) => o.setName("song").setDescription("artist - title (leave blank for current track)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("show recently played tracks this session"),
  new SlashCommandBuilder()
    .setName("savequeue")
    .setDescription("save the current queue as a named playlist")
    .addStringOption((o) =>
      o.setName("name").setDescription("playlist name (e.g. chill vibes)").setRequired(true).setMaxLength(50),
    ),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("manage saved playlists")
    .addSubcommand((s) =>
      s.setName("list").setDescription("show your saved playlists"),
    )
    .addSubcommand((s) =>
      s
        .setName("load")
        .setDescription("load a saved playlist into the queue")
        .addStringOption((o) => o.setName("name").setDescription("playlist name").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("delete a saved playlist")
        .addStringOption((o) => o.setName("name").setDescription("playlist name").setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("rate")
    .setDescription("fred rates anything out of 10")
    .addStringOption((o) => o.setName("thing").setDescription("what to rate").setRequired(true)),
  new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("ask the magic 8 ball (fred edition)")
    .addStringOption((o) => o.setName("question").setDescription("your yes/no question").setRequired(true)),
  new SlashCommandBuilder()
    .setName("ship")
    .setDescription("rate the romantic compatibility between two people")
    .addStringOption((o) => o.setName("person1").setDescription("first person").setRequired(true))
    .addStringOption((o) => o.setName("person2").setDescription("second person").setRequired(true)),
  new SlashCommandBuilder()
    .setName("hottake")
    .setDescription("fred delivers a spicy hot take")
    .addStringOption((o) => o.setName("topic").setDescription("topic (optional — leave blank for a random one)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("compliment")
    .setDescription("fred compliments someone (expect backhanded ones)")
    .addStringOption((o) => o.setName("user").setDescription("who to compliment").setRequired(true)),
  new SlashCommandBuilder()
    .setName("debate")
    .setDescription("fred picks a side and argues it")
    .addStringOption((o) => o.setName("topic").setDescription("topic to debate").setRequired(true)),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("check if fred is alive and measure latency"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("show current uptime, ai model, and token usage"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("show available commands"),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("search the web and get an answer")
    .addStringOption((o) =>
      o.setName("query").setDescription("what to search for").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("lore")
    .setDescription("search or view this server's collective memory and lore")
    .addStringOption((o) =>
      o.setName("query").setDescription("what to look up (leave blank for the full lore summary)").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("dossier")
    .setDescription("get fred's full psychological profile on a server member")
    .addUserOption((o) =>
      o.setName("user").setDescription("who to profile (defaults to you)").setRequired(false),
    ),

  // ── mod accessible ───────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("uwu")
    .setDescription("activate uwu mode (mode channel only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName("boomer")
    .setDescription("activate boomer mode (mode channel only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName("pirate")
    .setDescription("activate pirate mode (mode channel only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName("nerd")
    .setDescription("activate nerd mode (mode channel only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName("overlord")
    .setDescription("activate overlord mode (mode channel only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName("mode")
    .setDescription("deactivate the current mode (mode channel only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  // ── voice / tts ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("speak")
    .setDescription("make fred say something out loud in your voice channel")
    .addStringOption((o) =>
      o.setName("text").setDescription("what fred should say").setRequired(true).setMaxLength(450),
    ),

  // ── rave ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("rave")
    .setDescription("start infinite genre-based playback in your voice channel")
    .addStringOption((o) =>
      o.setName("genre").setDescription("genre to play — e.g. afrobeats, jazz, hiphop, lofi, rnb, pop").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("duration").setDescription("optional time limit — e.g. 1h, 90m, 2h30m").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("ravestop")
    .setDescription("stop the rave and disconnect"),

  // ── owner only ───────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("dossview")
    .setDescription("view a user's memory record")
    .addUserOption((o) => o.setName("user").setDescription("target user").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("dossdelete")
    .setDescription("delete a user's saved memory record")
    .addUserOption((o) => o.setName("user").setDescription("target user").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("dosswipe")
    .setDescription("wipe a user's saved record and live session")
    .addUserOption((o) => o.setName("user").setDescription("target user").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((cmd) => cmd.toJSON());

function buildVoiceSituation(message: Message): string | null {
  const guild = message.guild;
  const guildId = message.guildId;
  if (!guild || !guildId || !client) return null;

  const botMember = guild.members.me;
  const fredVoiceChannel = botMember?.voice?.channel;
  if (!fredVoiceChannel) return null;

  const humanMembers = fredVoiceChannel.members.filter((m) => !m.user.bot);
  if (humanMembers.size === 0) return null;

  const nameList = [...humanMembers.values()].slice(0, 4).map((m) => m.displayName);
  const extra = humanMembers.size > 4 ? ` + ${humanMembers.size - 4} more` : "";
  let voiceStr = `${nameList.join(", ")}${extra} in voice`;

  const queue = getQueue(guildId);
  if (queue?.current) {
    const t = queue.current;
    voiceStr += ` · playing: ${t.title.slice(0, 55)} by ${t.author.slice(0, 35)}`;
  }

  return voiceStr;
}

export async function startBot() {
  const rawToken = (
    process.env.TOKEN ??
    process.env.DISCORD_TOKEN ??
    process.env.BOT_TOKEN ??
    ""
  ).trim();

  if (!rawToken) {
    log("No TOKEN found (checked TOKEN, DISCORD_TOKEN, BOT_TOKEN) — bot will not start.", "discord");
    botState.lastError = "Missing bot token. Set the TOKEN environment variable on your host.";
    return;
  }

  if (client) {
    log("Destroying existing client before restarting.", "discord");
    clearBotBackgroundTasks();
    client.destroy();
    client = null;
  }

  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    ...(_messageContentEnabled ? [GatewayIntentBits.MessageContent] : []),
  ];

  if (!_messageContentEnabled) {
    log("Starting without MessageContent intent (not enabled in Discord Dev Portal — bot will still respond to mentions).", "discord");
  }

  client = new Client({ intents });

  client.once("ready", async (readyClient) => {
    log(`${readyClient.user.tag} is now active in the Lab.`, "discord");
    lastDiscordDisconnectAt = null;

    botState = {
      online: true,
      tag: readyClient.user.tag,
      avatarUrl: readyClient.user.displayAvatarURL({ size: 256 }),
      guildCount: readyClient.guilds.cache.size,
      uptimeStart: Date.now(),
      status: "dnd",
      activityName: "",
      activityType: "Custom",
      lastError: null,
    };

    startQotd(readyClient);
    startProactivityChecker(readyClient);
    startStatusShuffle(readyClient);
    initMusic(readyClient);
    void ensureGuildMemoryTable().catch(() => {});
    void ensureEpisodesTable().catch(() => {});

    // Initialise Fred's internal persona state per guild.
    for (const guild of readyClient.guilds.cache.values()) {
      void initFredState(guild.id).catch(() => {});
    }
    setNowPlayingCallback((guildId, track, queue) => {
      // New track is now playing — reset any pending skip votes from the previous one.
      clearSkipVotes(guildId);
      // DJ mode: crossfade + smart refill
      const djSession = djSessions.get(guildId);
      if (djSession) {
        onDjTrackStart(guildId, track, queue.volume, queue.player);
        if (queue.tracks.length <= 3) void refillDjQueue(guildId, djSession);
      }
      // Record to per-guild play history
      const hist = trackHistory.get(guildId) ?? [];
      hist.unshift({ title: track.title, author: track.author, duration: track.duration, uri: track.uri, requestedBy: track.requestedBy, playedAt: Date.now() });
      if (hist.length > HISTORY_LIMIT) hist.length = HISTORY_LIMIT;
      trackHistory.set(guildId, hist);
      const channel = readyClient.channels.cache.get(queue.textChannelId) as TextChannel | null;
      if (!channel) return;
      void (async () => {
        // Send immediately with YouTube thumbnail — no waiting on iTunes
        const sent = await channel.send({
          embeds: [buildNowPlayingEmbedFast(track, queue)],
          components: [buildMusicButtons(false)],
        });
        scheduleNowPlayingProgressUpdates(sent, guildId, track);

        // Upgrade to iTunes art in the background if available
        const art = await getAlbumArt(track);
        if (!art?.imageUrl) return;
        const q = getQueue(guildId);
        if (!q?.current || q.current.encoded !== track.encoded) return;
        await sent.edit({
          embeds: [await buildNowPlayingEmbed(track, q)],
          components: [buildMusicButtons(q.player.paused)],
          allowedMentions: { parse: [] },
        }).catch(() => {});
      })().catch(() => {});
    });
    setTextNotifyCallback((_guildId, textChannelId, message) => {
      const channel = readyClient.channels.cache.get(textChannelId) as TextChannel | null;
      if (!channel) return;
      channel.send({ content: message, allowedMentions: { parse: [] } }).catch(() => {});
    });
    setRaveClient(readyClient);
    startBotWatchdog();

    try {
      // Clear any leftover global commands to avoid duplicates with guild commands
      await readyClient.application.commands.set([]);

      // Register per-guild for immediate appearance (no propagation delay)
      const guildRegistrations = readyClient.guilds.cache.map((guild) =>
        guild.commands.set(SLASH_COMMANDS).catch((e: any) =>
          log(`Failed to register slash commands in guild ${guild.name}: ${e.message}`, "discord"),
        ),
      );
      await Promise.allSettled(guildRegistrations);
      log(`Registered ${SLASH_COMMANDS.length} slash commands in ${readyClient.guilds.cache.size} guild(s).`, "discord");
    } catch (err: any) {
      log(`Failed to register slash commands: ${err.message}`, "discord");
    }
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (await enforceSlurTimeout(message)) return;

    // Track last human message timestamp for every channel (conversation starter + other logic)
    channelLastHumanMessageAt.set(message.channelId, message.createdTimestamp);

    if (message.guildId) {
      const proactState = guildProactivityState.get(message.guildId);
      if (proactState?.mutedUntilHumanActivity) {
        proactState.mutedUntilHumanActivity = false;
        proactState.lastMessageAt = null;
      }
    }

    const io = getIO();
    if (io && getLiveViewerCount() > 0) {
      const liveMsg: LiveMessage = {
        id: `${message.id}-${Date.now()}`,
        messageId: message.id,
        channelId: message.channelId,
        channelName: (message.channel as TextChannel).name ?? "unknown",
        guildName: message.guild?.name ?? "DM",
        authorId: message.author.id,
        authorName: message.author.username,
        authorAvatar: message.author.displayAvatarURL({ size: 64 }) ?? null,
        content: message.content,
        attachments: message.attachments.map((a) => ({
          name: a.name,
          url: a.url,
          contentType: a.contentType ?? null,
          size: a.size,
        })),
        timestamp: message.createdTimestamp,
      };
      io.emit("liveFeed:message", liveMsg);
    }

    const isMentioned = client?.user && message.mentions.users.has(client.user.id);
    const COMMAND_PREFIX = /^[!?]fred\s*/i;
    const isPrefixed = COMMAND_PREFIX.test(message.content);

    // Standalone commands (no prefix/mention required)
    const rawContent = message.content.trim();
    const standaloneCmd = rawContent.toLowerCase();
    const legacyCommandDiscouragements = [
      "-# use the / commands instead. the punctuation era is tired.",
      "-# try the / commands next time. fred is begging you to evolve.",
      "-# / commands exist. use them before this bot develops back pain.",
    ];
    const shouldDiscourageLegacyCommand = /^[!?]/.test(rawContent) && !/^[!?]fred\b/i.test(rawContent);
    const legacyCommandDiscouragement = legacyCommandDiscouragements[
      [...rawContent].reduce((sum, char) => sum + char.charCodeAt(0), 0) % legacyCommandDiscouragements.length
    ];
    const appendLegacyCommandDiscouragement = (content: string): string => {
      if (!shouldDiscourageLegacyCommand || content.includes("\n-#")) return content;
      const next = content ? `${content}\n${legacyCommandDiscouragement}` : legacyCommandDiscouragement;
      return next.length <= 2000 ? next : content;
    };
    if (shouldDiscourageLegacyCommand) {
      const originalReply = message.reply.bind(message);
      message.reply = ((options: any) => {
        if (typeof options === "string") {
          return originalReply(appendLegacyCommandDiscouragement(options));
        }
        const next = { ...options };
        next.content = appendLegacyCommandDiscouragement(String(next.content ?? ""));
        return originalReply(next);
      }) as typeof message.reply;
    }
    const authorDisplayName = message.member?.displayName ?? message.author.username;
    const guildName = message.guild?.name ?? "unknown server";
    const channelName = (message.channel as TextChannel).name ?? "unknown";
    const sortedRoleEntries = [...(message.member?.roles.cache
      .filter((role) => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .values() ?? [])];
    const sortedRoleNames = sortedRoleEntries.map((r) => r.name);
    const roleNames = sortedRoleNames;
    const isOwner = roleNames.some((role) => role.trim().toLowerCase() === "owner")
      || message.guild?.ownerId === message.author.id;
    const activeModeKey = message.guildId ? guildModes.get(message.guildId) : undefined;
    const activeModeInstruction = activeModeKey ? BOT_MODES[activeModeKey]?.instruction : undefined;

    // Track all channel messages for context (push before building context below)
    if (message.content.trim()) {
      pushChannelMessage(message.channelId, authorDisplayName, message.content.trim(), false);
    }

    // Track user activity for last-seen awareness
    recordUserActivity(message.author.id);

    // Emotional intelligence: update per-user signal from message content
    if (message.content.trim().length >= 10) {
      updateUserEmotionalSignal(message.author.id, message.content);
    }

    // Semantic memory ingestion: every message Fred sees gets embedded + stored.
    if (message.guildId && message.content.trim()) {
      queueMemoryIngestion(message.author.id, message.guildId, message.content);
      // Tick guild message counter — triggers async lore extraction every N messages
      tickGuildMessageCounter(message.guildId, getChannelContextText(message.channelId));
    }

    // Episodic memory: queue extraction for personal content (non-blocking).
    if (message.guildId && message.content.trim().length >= 15) {
      queueEpisodeExtraction(message.author.id, message.guildId, message.content);
    }

    // Hypocrisy Engine: passive semantic analysis with per-user 2-min cooldown.
    if (message.guildId && message.content.trim().length >= 20) {
      void (async () => {
        try {
          const roast = await runHypocrisyEngine({
            userId: message.author.id,
            guildId: message.guildId!,
            authorName: authorDisplayName,
            content: message.content,
          });
          if (!roast) return;
          await (message.channel as TextChannel).sendTyping().catch(() => {});
          await message.reply({
            content: roast,
            allowedMentions: { parse: [], repliedUser: false },
          });
          pushChannelMessage(message.channelId, "fred", roast, true);
          // Block other passive replies from piling on right after a hypocrisy hit.
          // (we use the gemini module's own cooldown by emitting through pushChannelMessage)
        } catch (err: any) {
          log(`[Hypocrisy] handler failed: ${err.message}`, "discord");
        }
      })();
    }

    // Detect Discord reply-chain context
    let replyTo: string | undefined;
    let isReplyToBot = false;
    if (message.reference?.messageId) {
      try {
        const refMsg = await (message.channel as TextChannel).messages.fetch(message.reference.messageId);
        if (refMsg) {
          const refAuthor = refMsg.member?.displayName ?? refMsg.author.username;
          isReplyToBot = refMsg.author.bot && refMsg.author.id === client?.user?.id;
          const refPrefix = isReplyToBot ? "fred" : refAuthor;
          replyTo = `[${refPrefix}]: ${refMsg.content.slice(0, 300).trim()}`;
        }
      } catch {
        // silently ignore fetch errors
      }
    }

    const voiceSituation = buildVoiceSituation(message);
    const authorContext = { userId: message.author.id, roles: roleNames, sortedRoles: sortedRoleNames, isOwner, guildName, guildId: message.guildId ?? undefined, channelName, memberCount: message.guild?.memberCount ?? undefined, voiceSituation: voiceSituation || undefined, modeInstruction: activeModeInstruction, replyTo };

    // Any message starting with a known ? or ! command should never trigger passive watch
    const isAnyCommand = /^[!?](fred|status|help|ping|tldr|poem|roast|explain|translate|search|play|playtop|skip|stop|pause|resume|queue|np|volume|shuffle|loop|repeat|remove|move|clear|disconnect|leave|seek|uwu|boomer|pirate|nerd|overlord|mode|normal|dossview|dossdelete|dosswipe|qotd)\b/i.test(rawContent);

    // Treat as directed at the bot if: user said "fred" by name, or replied to a bot message
    const isNamedFred = /\bfred\b/i.test(rawContent);
    const isDirectedAtBot = isNamedFred || isReplyToBot;

    if (!isMentioned && !isPrefixed && !isDirectedAtBot && !isAnyCommand && message.guildId) {
      void (async () => {
        const guildCfg = await getGuildSettings(message.guildId!).catch(() => null);
        const chattiness = guildCfg?.chattiness ?? 5;
        if (chattiness === 0) return;
        if (guildCfg?.allowedChannels) {
          const allowed = guildCfg.allowedChannels.split(",").map((id) => id.trim()).filter(Boolean);
          if (allowed.length > 0 && !allowed.includes(message.channelId)) return;
        }
        queuePassiveWatch({
          messageId: message.id,
          channelId: message.channelId,
          guildId: message.guildId,
          authorId: message.author.id,
          authorName: authorDisplayName,
          content: message.content,
          isControversial: isPassiveWatchCandidate(message.content),
          hasInsult: /\b(fuck|shit|ass|bitch|idiot|moron|stupid|cringe|lame|slur|racist|sexist|nazi|fascist)\b/i.test(message.content),
          modeInstruction: activeModeInstruction,
          recentContext: replyTo ? `${replyTo}` : undefined,
          chattiness,
          sendReply: async (text: string) => {
            try {
              await (message.channel as TextChannel).sendTyping();
              await message.reply({
                content: text,
                allowedMentions: { parse: [], repliedUser: false },
              });
            } catch (err: any) {
              log(`[Passive] sendReply failed: ${err.message}`, "discord");
            }
          },
        });
      })();
    }

    // Passive image reaction: Fred reacts to images posted without @mention
    if (!isMentioned && !isPrefixed && !isDirectedAtBot && !isAnyCommand && message.guildId && message.attachments.size > 0) {
      const PASSIVE_IMG_MIME: Record<string, string> = {
        ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".webp": "image/webp",
      };
      const PASSIVE_IMG_EXTS = new Set(Object.keys(PASSIVE_IMG_MIME));
      const imgAttachments = message.attachments.filter((att) => {
        const ct = att.contentType?.split(";")[0].trim().toLowerCase() ?? "";
        const ext = att.name ? att.name.slice(att.name.lastIndexOf(".")).toLowerCase() : "";
        return ct.startsWith("image/") || PASSIVE_IMG_EXTS.has(ext);
      });

      if (imgAttachments.size > 0) {
        const now = Date.now();
        const lastReact = passiveImageCooldowns.get(message.channelId) ?? 0;
        const PASSIVE_IMG_COOLDOWN_MS = 5 * 60 * 1000;

        const guildCfgImg = await getGuildSettings(message.guildId!).catch(() => null);
        const imgChattiness = guildCfgImg?.chattiness ?? 5;
        const imgRoll = Math.min(0.35 * (imgChattiness / 5), 0.85);
        if (now - lastReact > PASSIVE_IMG_COOLDOWN_MS && imgChattiness > 0 && Math.random() < imgRoll) {
          passiveImageCooldowns.set(message.channelId, now);
          void (async () => {
            try {
              const MAX_INLINE_BYTES = 20 * 1024 * 1024;
              const mediaDataArray: ImageData[] = [];
              for (const att of imgAttachments.values()) {
                if ((att.size ?? 0) > MAX_INLINE_BYTES) continue;
                try {
                  const fetchUrl = att.proxyURL || att.url;
                  const res = await fetch(fetchUrl, { headers: { "Authorization": `Bot ${process.env.TOKEN}` } });
                  if (!res.ok) continue;
                  const buffer = await res.arrayBuffer();
                  const base64 = Buffer.from(buffer).toString("base64");
                  const ext = att.name ? att.name.slice(att.name.lastIndexOf(".")).toLowerCase() : "";
                  const mimeType = att.contentType?.split(";")[0].trim() || PASSIVE_IMG_MIME[ext] || "image/jpeg";
                  mediaDataArray.push({ mimeType, data: base64 });
                } catch { continue; }
              }
              if (mediaDataArray.length === 0) return;
              await (message.channel as TextChannel).sendTyping();
              const reply = await askGeminiWithImage("", authorDisplayName, message.channelId, mediaDataArray, authorContext);
              if (reply) {
                await message.reply({ content: reply, allowedMentions: { parse: [], repliedUser: false } });
                pushChannelMessage(message.channelId, "fred", reply, true);
                triggerUserMemoryUpdate(message.author.id);
              }
            } catch (err: any) {
              log(`[PassiveImage] Failed: ${err.message}`, "discord");
            }
          })();
        }
      }
    }

    const sendPrivate = async (content: string) => {
      try {
        await message.author.send(content);
      } catch (err: any) {
        await message.reply({
          content: "i can't dm you. open your dms if you want dossier commands to stay private.",
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
    };

    // Mode commands — only work in the designated mode channel
    const modeNames = Object.keys(BOT_MODES).join("|");
    const modeCmdMatch = standaloneCmd.match(new RegExp(`^\\?(${modeNames})$`));
    const modeOffMatch = standaloneCmd === "?mode" || standaloneCmd === "?normal";

    if (modeCmdMatch || modeOffMatch) {
      if (message.channelId !== MODE_CHANNEL_ID) {
        await message.reply({
          content: "mode commands only work in the designated mode channel.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      if (modeOffMatch) {
        const had = message.guildId ? guildModes.get(message.guildId) : undefined;
        if (message.guildId) {
          guildModes.delete(message.guildId);
          await clearModeTheme(message.guildId);
        }
        clearAllHistory();
        await message.reply({
          content: had ? `${BOT_MODES[had]?.label ?? had} deactivated. back to normal.` : "no mode was active. already normal.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      const modeKey = modeCmdMatch![1];
      const mode = BOT_MODES[modeKey];
      if (message.guildId) {
        guildModes.set(message.guildId, modeKey);
        await applyModeTheme(message.guildId, modeKey);
      }
      clearAllHistory();
      await message.reply({
        content: `${mode.label} activated serverwide. use \`?mode\` or \`?normal\` to turn it off.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    // ?lore <query>  — semantic search over the whole server
    const loreMatch = rawContent.match(/^\?lore\b\s*(.*)$/i);
    if (loreMatch) {
      if (!message.guildId) {
        await message.reply({
          content: "?lore only works inside a server. dms have no lore, just regret.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }
      const query = loreMatch[1].trim();
      try {
        await (message.channel as TextChannel).sendTyping();
        const summary = await searchServerLore(message.guildId, query);
        await message.reply({
          content: summary ?? "lore engine is offline. try again later.",
          allowedMentions: { parse: [], repliedUser: false },
        });
      } catch (err: any) {
        log(`[Lore] failed: ${err.message}`, "discord");
        await message.reply({
          content: "lore lookup broke. blame the embeddings.",
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
      return;
    }

    // ?dossier <@user>  — semantic psych profile from diverse memories
    const dossierProfileMatch = rawContent.match(/^\?dossier\b/i);
    if (dossierProfileMatch) {
      if (!message.guildId) {
        await message.reply({
          content: "?dossier only works inside a server.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }
      const target = message.mentions.users.first() ?? message.author;
      const targetMember = message.guild?.members.cache.get(target.id);
      const targetName = targetMember?.displayName ?? target.username;
      try {
        await (message.channel as TextChannel).sendTyping();
        const profile = await buildUserDossier(target.id, message.guildId, targetName);
        await message.reply({
          content: profile ?? "dossier engine is offline. try again later.",
          allowedMentions: { parse: [], repliedUser: false },
        });
      } catch (err: any) {
        log(`[Dossier:profile] failed: ${err.message}`, "discord");
        await message.reply({
          content: "dossier build broke. somehow.",
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
      return;
    }

    const dossierCommand = standaloneCmd.match(/^\?(dossview|dossdelete|dosswipe)\b/);
    if (dossierCommand) {
      try {
        await message.delete();
      } catch {
      }

      if (!isOwner) {
        await sendPrivate("no. dossier commands are owner-only.");
        return;
      }

      const command = dossierCommand[1];
      const target = message.mentions.users.first();
      if (!target) {
        await sendPrivate(`usage: ?${command} @user`);
        return;
      }

      try {
        if (command === "dossview") {
          const memory = await storage.getUserMemory(target.id);
          const possibilities = memory?.dossier?.trim() || "(none)";
          const sureties = memory?.sureties?.trim() || "(none)";
          await sendPrivate([
            `memory record for ${target.tag}:`,
            "",
            "[confirmed / sureties]",
            sureties,
            "",
            "[inferred / possibilities]",
            possibilities,
          ].join("\n"));
          return;
        }

        const deleted = await storage.deleteUserMemory(target.id);
        if (command === "dosswipe") {
          clearUserMemorySession(target.id);
        }

        await sendPrivate(
          command === "dosswipe"
            ? `${target.tag}'s saved dossier ${deleted ? "and live memory were wiped." : "was already empty; live memory was wiped."}`
            : `${target.tag}'s saved dossier ${deleted ? "was deleted." : "was already empty."}`,
        );
      } catch (err: any) {
        log(`[Dossier] Command failed: ${err.message}`, "discord");
        await sendPrivate(`dossier command failed: ${err.message}`);
      }
      return;
    }

    if (standaloneCmd === "?status") {
      const s = getAIStats();
      const uptime = botState.uptimeStart
        ? Math.floor((Date.now() - botState.uptimeStart) / 1000)
        : null;
      const uptimeStr = uptime != null
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
        : "unknown";
      const totalTokens = s.totalTokens.gemini + s.totalTokens.groq + s.totalTokens.hackclub;

      await message.reply({
        content: [
          "**bot status**",
          `online: ${botState.online ? "yes" : "no"}`,
          `uptime: ${uptimeStr}`,
          `servers: ${botState.guildCount}`,
          "",
          "**ai usage (this session)**",
          `last provider: ${s.lastUsedProvider ?? "none yet"}`,
          `last model: ${s.lastUsedModel ?? "none yet"}`,
          `total requests: ${s.totalRequests}`,
          `total tokens: ${totalTokens.toLocaleString()} (gemini: ${s.totalTokens.gemini.toLocaleString()} | groq: ${s.totalTokens.groq.toLocaleString()} | grok: ${s.totalTokens.hackclub.toLocaleString()})`,
          "",
          `version: ${process.env.npm_package_version ?? "dev"}`,
        ].join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "?help" || standaloneCmd === "!help") {
      const isModeChannel = message.channelId === MODE_CHANNEL_ID;
      const member = message.member;
      const userInVoice = !!member?.voice?.channel;
      const chName = channelName.toLowerCase();
      const isMusicChannel = userInVoice || /\b(bot|bots|command|commands|music|audio|vc|voice)\b/.test(chName);

      const helpLines: string[] = [
        "**commands**",
        "`?status` — current model, token usage, uptime",
        "`?help` — this list",
        "`?ping` — check if the bot is alive",
        "`?tldr` — summarize recent chat and check the vibe",
        "`?poem <topic>` — write a poem about something",
        "`?roast <target>` — roast a person, thing, or idea",
        "`?explain <topic>` — explain something in depth",
        "`?translate <language> <text>` — translate text",
        "`?search <query>` — search the web and get an answer",
        "`?fred <message>` — talk to the ai (`!fred` works too)",
        `or just ping <@${client?.user?.id}> with your message`,
        "or attach an image/video to any message to get a description",
      ];

      if (isMusicChannel) {
        helpLines.push(
          "",
          "**music commands**",
          "`?play <song/url>` — play a song or playlist by name or url",
          "`?playtop <song>` — add a song to the front of the queue",
          "`?skip` — skip the current track",
          "`?stop` — stop music and disconnect",
          "`?disconnect` / `?leave` — disconnect from voice",
          "`?pause` / `?resume` — pause or resume playback",
          "`?np` — show what's currently playing",
          "`?queue` — show the queue",
          "`?volume <0-100>` — set volume",
          "`?shuffle` — shuffle the queue",
          "`?loop` / `?repeat` — cycle loop mode (off → track → queue)",
          "`?seek <time>` — seek to a position, e.g. `?seek 1:30`",
          "`?remove <position>` — remove a track from the queue",
          "`?move <from> <to>` — reorder tracks in the queue",
          "`?clear` — clear the queue without stopping",
        );
      }

      if (isModeChannel) {
        helpLines.push(
          "",
          "**mode commands**",
          "`?uwu` — uwu speak mode",
          "`?boomer` — boomer mode",
          "`?pirate` — pirate mode",
          "`?nerd` — stereotypical nerd mode",
          "`?overlord` — megalomaniac AI mode",
          "`?mode` / `?normal` — turn off current mode",
        );
      }

      if (!isMusicChannel && !isModeChannel) {
        helpLines.push("", "*music commands available in bot/voice channels. mode commands available in the mode channel.*");
      } else if (!isMusicChannel) {
        helpLines.push("", "*music commands available in bot/voice channels.*");
      } else if (!isModeChannel) {
        helpLines.push("", "*mode commands available in the mode channel.*");
      }

      await message.reply({
        content: helpLines.join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "?ping") {
      const start = Date.now();
      const sent = await message.reply({
        content: "pong.",
        allowedMentions: { parse: [], repliedUser: false },
      });
      const latency = Date.now() - start;
      const wsLatency = client?.ws.ping ?? -1;
      await sent.edit(appendLegacyCommandDiscouragement(`pong. roundtrip: **${latency}ms** | ws: **${wsLatency}ms**`));
      return;
    }

    const taskCmdMatch = rawContent.match(/^\?(poem|roast|explain|translate|tldr)\s*([\s\S]*)?$/i);
    if (taskCmdMatch) {
      const taskName = taskCmdMatch[1].toLowerCase();
      const taskArg = (taskCmdMatch[2] ?? "").trim();

      let taskPrompt: string;

      if (taskName === "tldr") {
        try {
          await (message.channel as TextChannel).sendTyping();
          const fetched = await (message.channel as TextChannel).messages.fetch({ limit: 50 });
          const humanMessages = fetched
            .filter((m) => !m.author.bot)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

          const chatSummary = humanMessages.size === 0
            ? "[no recent messages — the channel is completely dead]"
            : humanMessages.map((m) => `${m.author.username}: ${m.content}`).join("\n");

          taskPrompt = `summarize the following chat in your style — concise, sharp, no padding. do not quote or repeat any messages verbatim. then on a new line, describe the current vibe in one sarcastic sentence. all lowercase, no emojis. output only your summary and vibe line, nothing else.\n\nchat log:\n${chatSummary}`;
        } catch (err: any) {
          log(`[Task:tldr] Error fetching messages: ${err.message}`, "discord");
          await message.reply({ content: "couldn't fetch messages to summarize. classic.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
      } else if (taskName === "poem") {
        if (!taskArg) {
          await message.reply({ content: "poem about what? give me a topic.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        taskPrompt = `write a poem about: ${taskArg}. make it actually good. keep your personality in it — sharp, darkly funny where appropriate, no sappy crap unless the topic demands it. proper length for a poem.`;
      } else if (taskName === "roast") {
        if (!taskArg) {
          await message.reply({ content: "roast what? give me a target.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        taskPrompt = `roast this person/thing/idea as brutally and wittily as possible: ${taskArg}. go all out. be creative, specific, and devastating.`;
      } else if (taskName === "explain") {
        if (!taskArg) {
          await message.reply({ content: "explain what? give me a topic.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        taskPrompt = `explain this thoroughly and accurately: ${taskArg}. be as detailed as the topic warrants. still in your voice, but actually useful.`;
      } else if (taskName === "translate") {
        const translateMatch = taskArg.match(/^(\S+)\s+([\s\S]+)$/);
        if (!translateMatch) {
          await message.reply({ content: "usage: `?translate <language> <text>`", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const [, lang, text] = translateMatch;
        taskPrompt = `translate the following text to ${lang}. output only the translation, nothing else.\n\n${text}`;
      } else {
        taskPrompt = taskArg || taskName;
      }

      try {
        await (message.channel as TextChannel).sendTyping();
        const reply = await askGemini(taskPrompt, authorDisplayName, message.channelId, authorContext);
        if (reply) {
          await message.reply({
            content: reply,
            allowedMentions: { parse: [], repliedUser: false },
          });
          pushChannelMessage(message.channelId, "fred", reply, true);
          triggerUserMemoryUpdate(message.author.id);
        }
      } catch (err: any) {
        log(`[Task:${taskName}] Failed: ${err.message}`, "discord");
      }
      return;
    }

    // ?search command
    const searchCmdMatch = rawContent.match(/^\?search\s+([\s\S]+)$/i);
    if (searchCmdMatch) {
      const searchQuery = searchCmdMatch[1].trim();
      try {
        await (message.channel as TextChannel).sendTyping();
        const searchResult = await searchWeb(searchQuery);
        let taskPrompt: string;
        if (searchResult && (searchResult.answer || searchResult.abstract || searchResult.results.length > 0 || searchResult.topics.length > 0)) {
          const searchContext = formatSearchResultsForAI(searchResult);
          taskPrompt = `the user asked you to search the web for: "${searchQuery}"\n\nthe following is LIVE data fetched right now — not your training data. use these results and ignore anything your training says about this topic:\n\n${searchContext}\n\nsummarize what you found in your voice. be accurate and specific with numbers/data. cite sources when available. stay in character.`;
        } else {
          taskPrompt = `the user asked: "${searchQuery}". you searched the web but got nothing useful back. answer from your own knowledge if you actually know — be specific and accurate. if you genuinely don't know, say so plainly. do NOT tell them to use a search command.`;
        }
        const reply = await askGemini(taskPrompt, authorDisplayName, message.channelId, authorContext);
        if (reply) {
          await message.reply({
            content: reply,
            allowedMentions: { parse: [], repliedUser: false },
          });
          pushChannelMessage(message.channelId, "fred", reply, true);
          triggerUserMemoryUpdate(message.author.id);
        }
      } catch (err: any) {
        log(`[Search] Command failed: ${err.message}`, "discord");
        await message.reply({ content: "search blew up on me. try again.", allowedMentions: { parse: [], repliedUser: false } });
      }
      return;
    }

    // music commands
    const musicCmdMatch = rawContent.match(/^\?(play|playtop|skip|stop|pause|resume|queue|np|nowplaying|volume|shuffle|loop|repeat|remove|move|clear|disconnect|leave|seek)\s*([\s\S]*)?$/i);
    if (musicCmdMatch) {
      const musicCmd = musicCmdMatch[1].toLowerCase();
      const musicArg = (musicCmdMatch[2] ?? "").trim();
      const guildId = message.guildId;

      if (!guildId) {
        await message.reply({ content: "music only works in servers.", allowedMentions: { parse: [], repliedUser: false } });
        return;
      }

      const member = message.member;
      const voiceChannel = member?.voice?.channel;

      if (musicCmd === "play") {
        if (!musicArg) {
          await message.reply({ content: "play what? give me a song name or url.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        if (!voiceChannel) {
          await message.reply({ content: "join a voice channel first.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        try {
          await (message.channel as TextChannel).sendTyping();
          const isUrl = /^https?:\/\//i.test(musicArg);
          if (isUrl) {
            const { tracks, playlistName } = await resolvePlaylist(musicArg, message.author.username);
            if (!tracks.length) {
              await message.reply({ content: "couldn't find anything. try a different link.", allowedMentions: { parse: [], repliedUser: false } });
              return;
            }
            if (tracks.length === 1) {
              const result = await joinAndPlay(guildId, voiceChannel.id, message.channelId, tracks[0], message.guild?.shardId ?? 0);
              if (result === "playing") {
                const q = getQueue(guildId)!;
                const sent = await message.reply({
                  embeds: [await buildNowPlayingEmbed(tracks[0], q)],
                  components: [buildMusicButtons(false)],
                  allowedMentions: { parse: [], repliedUser: false },
                });
                scheduleNowPlayingProgressUpdates(sent, guildId, tracks[0]);
              } else {
                const dur = tracks[0].isStream ? "LIVE" : formatDuration(tracks[0].duration);
                await message.reply({
                  content: `queued: **${tracks[0].title}** by ${tracks[0].author} [${dur}]`,
                  allowedMentions: { parse: [], repliedUser: false },
                });
              }
            } else {
              const result = await joinAndPlayMultiple(guildId, voiceChannel.id, message.channelId, tracks, message.guild?.shardId ?? 0);
              await message.reply({
                content: result === "playing"
                  ? `playing playlist **${playlistName ?? "untitled"}** — ${tracks.length} tracks loaded.`
                  : `queued playlist **${playlistName ?? "untitled"}** — ${tracks.length} tracks added.`,
                allowedMentions: { parse: [], repliedUser: false },
              });
            }
          } else {
            const track = await resolveTrack(musicArg, message.author.username);
            if (!track) {
              await message.reply({ content: "couldn't find that. try a different search.", allowedMentions: { parse: [], repliedUser: false } });
              return;
            }
            const result = await joinAndPlay(guildId, voiceChannel.id, message.channelId, track, message.guild?.shardId ?? 0);
            if (result === "playing") {
              const q = getQueue(guildId)!;
              const sent = await message.reply({
                embeds: [await buildNowPlayingEmbed(track, q)],
                components: [buildMusicButtons(false)],
                allowedMentions: { parse: [], repliedUser: false },
              });
              scheduleNowPlayingProgressUpdates(sent, guildId, track);
            } else {
              const dur = track.isStream ? "LIVE" : formatDuration(track.duration);
              await message.reply({
                content: `queued: **${track.title}** by ${track.author} [${dur}]`,
                allowedMentions: { parse: [], repliedUser: false },
              });
            }
          }
        } catch (err: any) {
          log(`[Music:play] ${err.message}`, "discord");
          await message.reply({ content: `music error: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "playtop") {
        if (!musicArg) {
          await message.reply({ content: "play what at the top? give me a song name or url.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        if (!voiceChannel) {
          await message.reply({ content: "join a voice channel first.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        try {
          await (message.channel as TextChannel).sendTyping();
          const track = await resolveTrack(musicArg, message.author.username);
          if (!track) {
            await message.reply({ content: "couldn't find that. try a different search.", allowedMentions: { parse: [], repliedUser: false } });
            return;
          }
          const result = await addToFront(guildId, voiceChannel.id, message.channelId, track, message.guild?.shardId ?? 0);
          if (result === "playing") {
            const q = getQueue(guildId)!;
            const sent = await message.reply({
              embeds: [await buildNowPlayingEmbed(track, q)],
              components: [buildMusicButtons(false)],
              allowedMentions: { parse: [], repliedUser: false },
            });
            scheduleNowPlayingProgressUpdates(sent, guildId, track);
          } else {
            const dur = track.isStream ? "LIVE" : formatDuration(track.duration);
            await message.reply({
              content: `added to top of queue: **${track.title}** by ${track.author} [${dur}]`,
              allowedMentions: { parse: [], repliedUser: false },
            });
          }
        } catch (err: any) {
          log(`[Music:playtop] ${err.message}`, "discord");
          await message.reply({ content: `music error: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "skip") {
        try {
          const result = await requestSkip(client!, guildId, message.author.id);
          await message.reply({ content: formatSkipReply(result), allowedMentions: { parse: [], repliedUser: false } });
        } catch (err: any) {
          await message.reply({ content: `skip failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "stop") {
        try {
          onDjStop(guildId);
          const stopped = await stopMusic(guildId);
          await message.reply({
            content: stopped ? "stopped and disconnected." : "i wasn't even playing anything.",
            allowedMentions: { parse: [], repliedUser: false },
          });
        } catch (err: any) {
          await message.reply({ content: `stop failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "disconnect" || musicCmd === "leave") {
        try {
          const done = await disconnectMusic(guildId);
          await message.reply({
            content: done ? "disconnected." : "i'm not in a voice channel.",
            allowedMentions: { parse: [], repliedUser: false },
          });
        } catch (err: any) {
          await message.reply({ content: `disconnect failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "reconnect" || musicCmd === "rc") {
        try {
          const result = await reconnectMusic(guildId);
          if (result.ok) {
            const where = result.trackTitle
              ? `resumed **${result.trackTitle}**${result.resumedAt > 0 ? ` at ${formatDuration(result.resumedAt)}` : ""}`
              : "queue is empty, but reconnected";
            const node = result.nodeName ? ` (now on \`${result.nodeName}\`)` : "";
            await message.reply({
              content: `reconnected to a fresh node${node} — ${where}.`,
              allowedMentions: { parse: [], repliedUser: false },
            });
          } else {
            await message.reply({
              content: `reconnect failed: ${result.message}`,
              allowedMentions: { parse: [], repliedUser: false },
            });
          }
        } catch (err: any) {
          await message.reply({ content: `reconnect failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "pause") {
        try {
          const paused = await pauseMusic(guildId);
          await message.reply({ content: paused ? "paused." : "nothing to pause.", allowedMentions: { parse: [], repliedUser: false } });
        } catch (err: any) {
          await message.reply({ content: `pause failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "resume") {
        try {
          {
            const resumed = await resumeMusic(guildId);
            await message.reply({ content: resumed ? "resumed." : "nothing to resume.", allowedMentions: { parse: [], repliedUser: false } });
          }
        } catch (err: any) {
          await message.reply({ content: `resume failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "queue") {
        const q = getQueue(guildId);
        if (!q || (!q.current && q.tracks.length === 0)) {
          await message.reply({ content: "queue is empty.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const lines: string[] = [];
        if (q.current) {
          const dur = q.current.isStream ? "LIVE" : formatDuration(q.current.duration);
          const pos = formatDuration(q.player.position);
          const loopLabel = q.loop !== "none" ? ` | loop: ${q.loop}` : "";
          lines.push(`**now playing:** ${q.current.title} [${pos}/${dur}] — req by ${q.current.requestedBy}${loopLabel}`);
        }
        if (q.tracks.length > 0) {
          lines.push("");
          lines.push("**up next:**");
          q.tracks.slice(0, 10).forEach((t, i) => {
            const dur = t.isStream ? "LIVE" : formatDuration(t.duration);
            lines.push(`${i + 1}. ${t.title} [${dur}] — req by ${t.requestedBy}`);
          });
          if (q.tracks.length > 10) lines.push(`…and ${q.tracks.length - 10} more`);
        }
        await message.reply({ content: lines.join("\n"), allowedMentions: { parse: [], repliedUser: false } });
        return;
      }

      if (musicCmd === "np" || musicCmd === "nowplaying") {
        const q = getQueue(guildId);
        if (!q?.current) {
          await message.reply({ content: "nothing is playing.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const sent = await message.reply({
          embeds: [await buildNowPlayingEmbed(q.current, q)],
          components: [buildMusicButtons(q.player.paused)],
          allowedMentions: { parse: [], repliedUser: false },
        });
        scheduleNowPlayingProgressUpdates(sent, guildId, q.current);
        return;
      }

      if (musicCmd === "volume") {
        const vol = parseInt(musicArg, 10);
        if (isNaN(vol) || vol < 0 || vol > 100) {
          await message.reply({ content: "volume must be a number between 0 and 100.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        try {
          const set = await setMusicVolume(guildId, vol);
          await message.reply({
            content: set ? `volume set to ${vol}%.` : "nothing is playing.",
            allowedMentions: { parse: [], repliedUser: false },
          });
        } catch (err: any) {
          await message.reply({ content: `volume failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "shuffle") {
        const done = shuffleQueue(guildId);
        await message.reply({
          content: done ? "queue shuffled." : "not enough tracks in the queue to shuffle.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      if (musicCmd === "loop" || musicCmd === "repeat") {
        const newMode = cycleLoop(guildId);
        if (newMode === null) {
          await message.reply({ content: "nothing is playing.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const labels: Record<string, string> = { none: "loop off", track: "looping current track", queue: "looping entire queue" };
        await message.reply({ content: labels[newMode] ?? newMode, allowedMentions: { parse: [], repliedUser: false } });
        return;
      }

      if (musicCmd === "remove") {
        const idx = parseInt(musicArg, 10);
        if (isNaN(idx) || idx < 1) {
          await message.reply({ content: "usage: `?remove <position>` (use `?queue` to see positions)", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const removed = removeTrack(guildId, idx);
        await message.reply({
          content: removed ? `removed **${removed.title}** from the queue.` : "no track at that position.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      if (musicCmd === "move") {
        const parts = musicArg.split(/\s+/);
        const from = parseInt(parts[0], 10);
        const to = parseInt(parts[1], 10);
        if (isNaN(from) || isNaN(to)) {
          await message.reply({ content: "usage: `?move <from> <to>` (positions from `?queue`)", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const done = moveTrack(guildId, from, to);
        await message.reply({
          content: done ? `moved track from position ${from} to ${to}.` : "invalid positions.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      if (musicCmd === "autoplay") {
        const arg = musicArg.trim().toLowerCase();
        let desired: boolean;
        if (arg === "on" || arg === "true" || arg === "yes" || arg === "1") {
          desired = true;
        } else if (arg === "off" || arg === "false" || arg === "no" || arg === "0") {
          desired = false;
        } else {
          desired = !isAutoplayEnabled(guildId);
        }
        const result = setAutoplay(guildId, desired);
        if (result === null) {
          await message.reply({ content: "nothing is playing — start a track first, then toggle autoplay.", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        await message.reply({
          content: result
            ? "🎶 autoplay **on** — i'll keep the vibe going with similar tracks when the queue runs out."
            : "autoplay **off** — i'll stop when the queue ends.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      if (musicCmd === "clear") {
        const count = clearQueue(guildId);
        await message.reply({
          content: count > 0 ? `cleared ${count} track${count === 1 ? "" : "s"} from the queue.` : "queue was already empty.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        return;
      }

      if (musicCmd === "seek") {
        if (!musicArg) {
          await message.reply({ content: "usage: `?seek <time>` — e.g. `?seek 1:30` or `?seek 90`", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        const ms = parseSeekTime(musicArg);
        if (ms === null) {
          await message.reply({ content: "invalid time format. use `1:30` or `90` (seconds).", allowedMentions: { parse: [], repliedUser: false } });
          return;
        }
        try {
          const done = await seekTrack(guildId, ms);
          await message.reply({
            content: done ? `seeked to ${formatDuration(ms)}.` : "can't seek — nothing playing or it's a livestream.",
            allowedMentions: { parse: [], repliedUser: false },
          });
        } catch (err: any) {
          await message.reply({ content: `seek failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }
    }

    if ((isMentioned || isPrefixed || isDirectedAtBot) && client?.user) {
      let cleanContent = message.content;

      if (isMentioned) {
        cleanContent = cleanContent.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "");
      }

      if (isPrefixed) {
        cleanContent = cleanContent.replace(COMMAND_PREFIX, "");
      }

      cleanContent = cleanContent.trim();

      const SUPPORTED_MEDIA_TYPES = [
        "image/png", "image/jpeg", "image/webp", "image/gif",
        "video/mp4", "video/mpeg", "video/webm", "video/quicktime",
        "video/mov", "video/avi", "video/3gpp", "video/x-flv", "video/wmv",
      ];
      const SUPPORTED_MEDIA_EXTS = [
        ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".mp4", ".mpeg", ".webm", ".mov", ".avi", ".mkv", ".3gp",
      ];
      const MAX_INLINE_BYTES = 20 * 1024 * 1024;

      const mimeFromExt = (name: string): string => {
        const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
        const map: Record<string, string> = {
          ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg", ".webp": "image/webp",
          ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
          ".avi": "video/x-msvideo", ".mkv": "video/webm",
          ".3gp": "video/3gpp", ".mpeg": "video/mpeg",
        };
        return map[ext] ?? "application/octet-stream";
      };

      // Detect media — wrapped in try-catch so any discord.js edge case can't
      // silently kill the entire handler before we even try to respond.
      let hasMedia = false;
      let mediaAttachments = message.attachments.filter(() => false);
      const tenorMediaUrls: string[] = [];
      try {
        mediaAttachments = message.attachments.filter((att) => {
          const ct = att.contentType?.split(";")[0].trim().toLowerCase() ?? "";
          const ext = att.name ? att.name.slice(att.name.lastIndexOf(".")).toLowerCase() : "";
          const urlLower = att.url.toLowerCase().split("?")[0];
          return (
            SUPPORTED_MEDIA_TYPES.includes(ct) ||
            SUPPORTED_MEDIA_EXTS.includes(ext) ||
            SUPPORTED_MEDIA_EXTS.some((e) => urlLower.endsWith(e))
          );
        });

        // Tenor / gifv embeds — Discord wraps these as embeds, not attachments.
        // Use embed.data.type because Discord.js v14 Embed class has no .type getter.
        for (const embed of message.embeds) {
          const embedType = (embed as any).data?.type ?? (embed as any).type;
          if (embedType === "gifv") {
            const url = embed.video?.url ?? embed.thumbnail?.url;
            if (url) tenorMediaUrls.push(url);
          }
        }

        hasMedia = mediaAttachments.size > 0 || tenorMediaUrls.length > 0;
      } catch (mediaErr: any) {
        log(`[Gemini] Media detection error: ${mediaErr.message}`, "discord");
      }

      if (!cleanContent && !hasMedia) return;

      const mediaCount = mediaAttachments.size + tenorMediaUrls.length;
      log(`[Gemini] Handling from ${authorDisplayName}: ${cleanContent.slice(0, 80)}${mediaCount > 0 ? ` [+${mediaCount} media]` : ""}`, "discord");

      // Auto-detect web search intent in @fred / ?fred messages
      if (cleanContent && !hasMedia) {
        const searchQuery = detectSearchIntent(cleanContent);
        if (searchQuery) {
          let searchHandled = false;
          try {
            await (message.channel as TextChannel).sendTyping();
            log(`[Search] Auto-detected search intent: ${searchQuery.slice(0, 60)}`, "discord");
            const searchResult = await searchWeb(searchQuery);
            const hasUsefulResults = searchResult && (
              searchResult.answer || searchResult.abstract ||
              searchResult.results.length > 0 || searchResult.topics.length > 0
            );
            if (hasUsefulResults) {
              const searchContext = formatSearchResultsForAI(searchResult!);
              const searchPrompt = `the user asked: "${cleanContent}"\n\nyou searched the web for: "${searchQuery}"\n\nthe following is LIVE data fetched right now — not your training data. trust these numbers and ignore what your training says about this topic:\n\n${searchContext}\n\nrespond to the user's question using ONLY the search results above. be accurate and specific with numbers/data. cite sources. stay in character as fred.`;
              const reply = await askGemini(searchPrompt, authorDisplayName, message.channelId, authorContext);
              if (reply) {
                await message.reply({
                  content: reply,
                  allowedMentions: { parse: [], repliedUser: false },
                });
                pushChannelMessage(message.channelId, "fred", reply, true);
                triggerUserMemoryUpdate(message.author.id);
                searchHandled = true;
              }
            }
          } catch (err: any) {
            log(`[Search] Auto-search failed: ${err.message}`, "discord");
          }
          if (searchHandled) return;
          // Search returned no useful results — fall through to regular AI response below
        }
      }

      try {
        await (message.channel as TextChannel).sendTyping();

        if (hasMedia) {
          const mediaDataArray: ImageData[] = [];

          for (const att of mediaAttachments.values()) {
            if ((att.size ?? 0) > MAX_INLINE_BYTES) {
              log(`[Gemini] Skipping oversized attachment: ${att.name} (${att.size} bytes)`, "discord");
              continue;
            }
            try {
              // Use proxyURL — the public media proxy that doesn't require bot auth.
              // att.url is the CDN URL which requires Authorization headers for PC-uploaded files.
              const fetchUrl = att.proxyURL || att.url;
              const res = await fetch(fetchUrl, {
                headers: { "Authorization": `Bot ${process.env.TOKEN}` },
              });
              if (!res.ok) {
                log(`[Gemini] Attachment fetch failed: HTTP ${res.status} for ${att.name}`, "discord");
                continue;
              }
              const buffer = await res.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const mimeType =
                att.contentType?.split(";")[0].trim() ||
                mimeFromExt(att.name ?? "");
              mediaDataArray.push({ mimeType, data: base64 });
            } catch (fetchErr: any) {
              log(`[Gemini] Failed to fetch attachment: ${fetchErr.message}`, "discord");
            }
          }

          for (const url of tenorMediaUrls) {
            try {
              const res = await fetch(url);
              const buffer = await res.arrayBuffer();
              if (buffer.byteLength > MAX_INLINE_BYTES) {
                log(`[Gemini] Skipping oversized Tenor embed`, "discord");
                continue;
              }
              const base64 = Buffer.from(buffer).toString("base64");
              const ct = res.headers.get("content-type")?.split(";")[0].trim() ?? "video/mp4";
              mediaDataArray.push({ mimeType: ct, data: base64 });
            } catch (fetchErr: any) {
              log(`[Gemini] Failed to fetch Tenor embed: ${fetchErr.message}`, "discord");
            }
          }

          if (mediaDataArray.length > 0) {
            const reply = await askGeminiWithImage(cleanContent, authorDisplayName, message.channelId, mediaDataArray, authorContext);
            if (reply) {
              await message.reply({
                content: reply,
                allowedMentions: { parse: [], repliedUser: false },
              });
              pushChannelMessage(message.channelId, "fred", reply, true);
              triggerUserMemoryUpdate(message.author.id);
            }
            return;
          }
        }

        const reply = await askGemini(cleanContent, authorDisplayName, message.channelId, authorContext);
        if (reply) {
          await message.reply({
            content: reply,
            allowedMentions: { parse: [], repliedUser: false },
          });
          pushChannelMessage(message.channelId, "fred", reply, true);
          triggerUserMemoryUpdate(message.author.id);
        }
      } catch (err: any) {
        log(`[Gemini] Failed to reply: ${err.message}`, "discord");
      }
    }
  });

  client.on("interactionCreate", async (interaction) => {
    // autocomplete handler
    if (interaction.isAutocomplete()) {
      const { commandName } = interaction;
      if ((commandName === "play" || commandName === "playtop") && interaction.options.getFocused(true).name === "query") {
        const query = interaction.options.getFocused();
        if (!query || query.trim().length < 2) {
          await interaction.respond([]);
          return;
        }
        try {
          const results = await searchTracks(query.trim(), 8);
          const choices = results.map((r) => {
            const dur = r.isStream ? "LIVE" : formatDuration(r.duration);
            const label = `${r.title} — ${r.author} [${dur}]`.slice(0, 100);
            const value = r.uri.slice(0, 100);
            return { name: label, value };
          });
          await interaction.respond(choices);
        } catch {
          await interaction.respond([]);
        }
      }
      return;
    }

    // Music button handler
    if (interaction.isButton() && interaction.customId.startsWith("music_")) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: "music only works in servers.", ephemeral: true });
        return;
      }
      const action = interaction.customId.slice("music_".length);
      const q = getQueue(guildId);

      if (action === "pause") {
        if (!q?.current) {
          await interaction.reply({ content: "nothing is playing.", ephemeral: true });
          return;
        }
        const wasPaused = q.player.paused;
        if (wasPaused) {
          await resumeMusic(guildId);
        } else {
          await pauseMusic(guildId);
        }
        const qAfter = getQueue(guildId)!;
        await interaction.update({
          embeds: [await buildNowPlayingEmbed(qAfter.current!, qAfter)],
          components: [buildMusicButtons(!wasPaused)],
        });
        scheduleNowPlayingProgressUpdates(interaction.message as Message, guildId, qAfter.current!);
        return;
      }

      if (action === "skip") {
        if (!q?.current) {
          await interaction.reply({ content: "nothing is playing.", ephemeral: true });
          return;
        }
        const result = await requestSkip(client!, guildId, interaction.user.id);
        if (result.kind === "skipped") {
          await interaction.update({
            content: formatSkipReply(result),
            embeds: [],
            components: [],
          });
        } else if (result.kind === "voted" || result.kind === "already-voted") {
          // Keep the now-playing embed visible; reply ephemerally with vote status.
          await interaction.reply({ content: formatSkipReply(result), ephemeral: true });
        } else {
          await interaction.reply({ content: formatSkipReply(result), ephemeral: true });
        }
        return;
      }

      if (action === "back") {
        if (!q?.current) {
          await interaction.reply({ content: "nothing is playing.", ephemeral: true });
          return;
        }
        await seekTrack(guildId, 0);
        const qAfter = getQueue(guildId)!;
        await interaction.update({
          embeds: [await buildNowPlayingEmbed(qAfter.current!, qAfter)],
          components: [buildMusicButtons(qAfter.player.paused)],
        });
        scheduleNowPlayingProgressUpdates(interaction.message as Message, guildId, qAfter.current!);
        return;
      }

      if (action === "stop") {
        await stopMusic(guildId);
        await interaction.update({
          content: "⏹  Stopped and disconnected.",
          embeds: [],
          components: [],
        });
        return;
      }

      if (action === "like") {
        if (!q?.current) {
          await interaction.reply({ content: "nothing is playing right now.", ephemeral: true });
          return;
        }
        const track = q.current;
        const isSpotify = /open\.spotify\.com|spotify:/i.test(track.uri);
        const spotifyLink = isSpotify
          ? track.uri
          : `https://open.spotify.com/search/${encodeURIComponent(`${track.title} ${track.author}`)}`;
        const sourceLabel = isSpotify ? "🎧 Spotify" : "🔗 Source";

        const dmEmbed = new EmbedBuilder()
          .setTitle("❤️ Saved to your liked songs")
          .setDescription(
            [
              `**${track.title}**`,
              `by ${track.author}`,
              "",
              `[${sourceLabel}](${track.uri})` + (isSpotify ? "" : ` · [🎧 Spotify](${spotifyLink})`),
            ].join("\n"),
          )
          .setURL(track.uri)
          .setColor(0xed4245);
        if (track.artworkUrl) dmEmbed.setThumbnail(track.artworkUrl);
        const guildName = interaction.guild?.name;
        if (guildName) dmEmbed.setFooter({ text: `from ${guildName}` });

        try {
          const dm = await interaction.user.createDM();
          await dm.send({
            content: isSpotify
              ? `🎧 ${spotifyLink}`
              : `🔗 ${track.uri}\n🎧 ${spotifyLink}`,
            embeds: [dmEmbed],
            allowedMentions: { parse: [] },
          });
          await interaction.reply({
            content: `❤️ saved **${track.title}** to your DMs.`,
            ephemeral: true,
          });
        } catch (err: any) {
          await interaction.reply({
            content: "couldn't DM you — check that your DMs are open for this server, then try again.",
            ephemeral: true,
          });
        }
        return;
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // Build role names from guild member cache
    const roleNames: string[] = [];
    if (interaction.guild) {
      const guildMember = interaction.guild.members.cache.get(interaction.user.id);
      if (guildMember) {
        guildMember.roles.cache
          .filter((r) => r.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .forEach((r) => roleNames.push(r.name));
      }
    }
    const isOwner = roleNames.some((r) => r.trim().toLowerCase() === "owner")
      || interaction.guild?.ownerId === interaction.user.id;
    const authorDisplayName = (interaction.member as any)?.displayName ?? interaction.user.username;
    const guildName = interaction.guild?.name ?? "unknown server";
    const channelName = (interaction.channel as TextChannel)?.name ?? "unknown";
    const activeModeKey = interaction.guildId ? guildModes.get(interaction.guildId) : undefined;
    const activeModeInstruction = activeModeKey ? BOT_MODES[activeModeKey]?.instruction : undefined;
    const authorContext = {
      userId: interaction.user.id,
      roles: roleNames,
      sortedRoles: roleNames,
      isOwner,
      guildName,
      guildId: interaction.guildId ?? undefined,
      channelName,
      memberCount: interaction.guild?.memberCount ?? undefined,
      modeInstruction: activeModeInstruction,
    };

    const replyEph = (content: string) =>
      interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });

    // ping
    if (commandName === "ping") {
      const start = Date.now();
      await interaction.reply({ content: "pong.", allowedMentions: { parse: [] } });
      await interaction.editReply(`pong. roundtrip: **${Date.now() - start}ms** | ws: **${client?.ws.ping ?? -1}ms**`);
      return;
    }

    // status
    if (commandName === "status") {
      const s = getAIStats();
      const uptime = botState.uptimeStart ? Math.floor((Date.now() - botState.uptimeStart) / 1000) : null;
      const uptimeStr = uptime != null
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
        : "unknown";
      const totalTokens = s.totalTokens.gemini + s.totalTokens.groq + s.totalTokens.hackclub;
      await interaction.reply({
        content: [
          "**bot status**",
          `online: ${botState.online ? "yes" : "no"}`,
          `uptime: ${uptimeStr}`,
          `servers: ${botState.guildCount}`,
          "",
          "**ai usage (this session)**",
          `last provider: ${s.lastUsedProvider ?? "none yet"}`,
          `last model: ${s.lastUsedModel ?? "none yet"}`,
          `total requests: ${s.totalRequests}`,
          `total tokens: ${totalTokens.toLocaleString()} (gemini: ${s.totalTokens.gemini.toLocaleString()} | groq: ${s.totalTokens.groq.toLocaleString()} | grok: ${s.totalTokens.hackclub.toLocaleString()})`,
        ].join("\n"),
        allowedMentions: { parse: [] },
      });
      return;
    }

    // help
    if (commandName === "help") {
      const isModeChannel = interaction.channelId === MODE_CHANNEL_ID;
      const slashMember = interaction.guild?.members.cache.get(interaction.user.id);
      const userInVoice = !!slashMember?.voice?.channel;
      const slashChName = channelName.toLowerCase();
      const isMusicChannel = userInVoice || /\b(bot|bots|command|commands|music|audio|vc|voice)\b/.test(slashChName);

      const slashHelpLines: string[] = [
        "**commands** (use `/` or `?` prefix)",
        "",
        "**general**",
        "`/help` — this list",
        "`/ping` — check if the bot is alive",
        "`/status` — current model, token usage, uptime",
        "`/tldr` — summarize recent chat and check the vibe",
        "`/poem <topic>` — write a poem about something",
        "`/roast <target>` — roast a person, thing, or idea",
        "`/explain <topic>` — explain something in depth",
        "`/translate <language> <text>` — translate text",
        "`/search <query>` — search the web and get an answer",
        "`/fred <message>` — talk to the ai",
        "`/lore [query]` — search this server's collective memory",
        "`/dossier [@user]` — fred's psych profile on someone",
        `or just ping <@${client?.user?.id}> with your message`,
        "or attach an image/video to any message to get a description",
      ];

      if (isMusicChannel) {
        slashHelpLines.push(
          "",
          "**music**",
          "`/play <query>` — play a song (or `?play`)",
          "`/skip` — skip current track",
          "`/stop` — stop and disconnect",
          "`/pause` / `/resume` — pause or resume",
          "`/nowplaying` — show current track",
          "`/volume <0-100>` — set volume",
          "`/queue` — show the queue",
          "`/lyrics [artist - title]` — fetch lyrics for current/specified song",
          "`/history` — show recently played tracks",
          "",
          "**rave mode**",
          "`/rave <genre>` — play a genre infinitely (e.g. afrobeats, jazz, lofi)",
          "`/ravestop` — stop the rave",
          "",
          "**fun**",
          "`/rate <thing>` — fred rates anything out of 10",
          "`/8ball <question>` — ask the oracle",
          "`/ship <a> <b>` — compatibility check",
          "`/hottake [topic]` — hot take incoming",
          "`/compliment <user>` — (backhanded) compliment",
          "`/debate <topic>` — fred picks a side",
        );
      }

      if (isModeChannel) {
        slashHelpLines.push(
          "",
          "**mode**",
          "`/uwu` — uwu speak mode",
          "`/boomer` — boomer mode",
          "`/pirate` — pirate mode",
          "`/nerd` — stereotypical nerd mode",
          "`/overlord` — megalomaniac AI mode",
          "`/mode` — turn off current mode",
        );
      }

      if (!isMusicChannel && !isModeChannel) {
        slashHelpLines.push("", "*music and dj commands available in bot/voice channels. mode commands available in the mode channel.*");
      } else if (!isMusicChannel) {
        slashHelpLines.push("", "*music and dj commands available in bot/voice channels.*");
      } else if (!isModeChannel) {
        slashHelpLines.push("", "*mode commands available in the mode channel.*");
      }

      await interaction.reply({
        content: slashHelpLines.join("\n"),
        allowedMentions: { parse: [] },
      });
      return;
    }

    // search
    if (commandName === "search") {
      const query = interaction.options.getString("query", true).trim();
      await interaction.deferReply();
      try {
        const searchResult = await searchWeb(query);
        let taskPrompt: string;
        if (searchResult && (searchResult.answer || searchResult.abstract || searchResult.results.length > 0 || searchResult.topics.length > 0)) {
          const searchContext = formatSearchResultsForAI(searchResult);
          taskPrompt = `the user asked you to search the web for: "${query}"\n\nthe following is LIVE data fetched right now — not your training data. use these results and ignore anything your training says about this topic:\n\n${searchContext}\n\nsummarize what you found in your voice. be accurate and specific with numbers/data. cite sources when available. stay in character.`;
        } else {
          taskPrompt = `the user asked: "${query}". you searched the web but got nothing useful back. answer from your own knowledge if you actually know — be specific and accurate. if you genuinely don't know, say so plainly.`;
        }
        const reply = await askGemini(taskPrompt, authorDisplayName, interaction.channelId, authorContext);
        if (reply) {
          await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
          pushChannelMessage(interaction.channelId, "fred", reply, true);
          triggerUserMemoryUpdate(interaction.user.id);
        } else {
          await interaction.editReply({ content: "search returned nothing useful.", allowedMentions: { parse: [] } });
        }
      } catch (err: any) {
        log(`[Slash:search] Failed: ${err.message}`, "discord");
        try { await interaction.editReply({ content: "search blew up. try again.", allowedMentions: { parse: [] } }); } catch {}
      }
      return;
    }

    // lore
    if (commandName === "lore") {
      if (!interaction.guildId) {
        await replyEph("lore only works in servers. dms have no lore, just regret.");
        return;
      }
      const query = interaction.options.getString("query", false)?.trim() ?? "";
      await interaction.deferReply();
      try {
        const summary = await searchServerLore(interaction.guildId, query);
        await interaction.editReply({
          content: summary ?? "lore engine is offline. try again later.",
          allowedMentions: { parse: [] },
        });
      } catch (err: any) {
        log(`[Slash:lore] Failed: ${err.message}`, "discord");
        try { await interaction.editReply({ content: "lore lookup broke. blame the embeddings.", allowedMentions: { parse: [] } }); } catch {}
      }
      return;
    }

    // music slash commands
    const MUSIC_SLASH_CMDS = ["play", "playtop", "skip", "stop", "reconnect", "disconnect", "pause", "resume", "queue", "nowplaying", "volume", "shuffle", "loop", "seek", "remove", "move", "clear", "autoplay"];
    if (MUSIC_SLASH_CMDS.includes(commandName)) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: "music only works in servers.", ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }

      if (commandName === "play") {
        const query = interaction.options.getString("query", true);
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
          await interaction.reply({ content: "join a voice channel first.", ephemeral: true, allowedMentions: { parse: [] } });
          return;
        }
        await interaction.deferReply();
        try {
          const isUrl = /^https?:\/\//i.test(query);
          if (isUrl) {
            const { tracks, playlistName } = await resolvePlaylist(query, interaction.user.username);
            if (!tracks.length) {
              await interaction.editReply({ content: "couldn't find anything. try a different link.", allowedMentions: { parse: [] } });
              return;
            }
            if (tracks.length === 1) {
              const result = await joinAndPlay(guildId, voiceChannel.id, interaction.channelId, tracks[0], interaction.guild?.shardId ?? 0);
              if (result === "playing") {
                const q = getQueue(guildId)!;
                const sent = await interaction.editReply({
                  embeds: [await buildNowPlayingEmbed(tracks[0], q)],
                  components: [buildMusicButtons(false)],
                  allowedMentions: { parse: [] },
                });
                scheduleNowPlayingProgressUpdates(sent, guildId, tracks[0]);
              } else {
                const dur = tracks[0].isStream ? "LIVE" : formatDuration(tracks[0].duration);
                await interaction.editReply({
                  content: `queued: **${tracks[0].title}** by ${tracks[0].author} [${dur}]`,
                  allowedMentions: { parse: [] },
                });
              }
            } else {
              const result = await joinAndPlayMultiple(guildId, voiceChannel.id, interaction.channelId, tracks, interaction.guild?.shardId ?? 0);
              await interaction.editReply({
                content: result === "playing"
                  ? `playing playlist **${playlistName ?? "untitled"}** — ${tracks.length} tracks loaded.`
                  : `queued playlist **${playlistName ?? "untitled"}** — ${tracks.length} tracks added.`,
                allowedMentions: { parse: [] },
              });
            }
          } else {
            const track = await resolveTrack(query, interaction.user.username);
            if (!track) {
              await interaction.editReply({ content: "couldn't find that. try a different search.", allowedMentions: { parse: [] } });
              return;
            }
            const result = await joinAndPlay(guildId, voiceChannel.id, interaction.channelId, track, interaction.guild?.shardId ?? 0);
            if (result === "playing") {
              const q = getQueue(guildId)!;
              const sent = await interaction.editReply({
                embeds: [await buildNowPlayingEmbed(track, q)],
                components: [buildMusicButtons(false)],
                allowedMentions: { parse: [] },
              });
              scheduleNowPlayingProgressUpdates(sent, guildId, track);
            } else {
              const dur = track.isStream ? "LIVE" : formatDuration(track.duration);
              await interaction.editReply({
                content: `queued: **${track.title}** by ${track.author} [${dur}]`,
                allowedMentions: { parse: [] },
              });
            }
          }
        } catch (err: any) {
          log(`[Music/slash:play] ${err.message}`, "discord");
          await interaction.editReply({ content: `music error: ${err.message}`, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "playtop") {
        const query = interaction.options.getString("query", true);
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
          await interaction.reply({ content: "join a voice channel first.", ephemeral: true, allowedMentions: { parse: [] } });
          return;
        }
        await interaction.deferReply();
        try {
          const track = await resolveTrack(query, interaction.user.username);
          if (!track) {
            await interaction.editReply({ content: "couldn't find that. try a different search.", allowedMentions: { parse: [] } });
            return;
          }
          const result = await addToFront(guildId, voiceChannel.id, interaction.channelId, track, interaction.guild?.shardId ?? 0);
          if (result === "playing") {
            const q = getQueue(guildId)!;
            const sent = await interaction.editReply({
              embeds: [await buildNowPlayingEmbed(track, q)],
              components: [buildMusicButtons(false)],
              allowedMentions: { parse: [] },
            });
            scheduleNowPlayingProgressUpdates(sent, guildId, track);
          } else {
            const dur = track.isStream ? "LIVE" : formatDuration(track.duration);
            await interaction.editReply({
              content: `added to top of queue: **${track.title}** by ${track.author} [${dur}]`,
              allowedMentions: { parse: [] },
            });
          }
        } catch (err: any) {
          log(`[Music/slash:playtop] ${err.message}`, "discord");
          await interaction.editReply({ content: `music error: ${err.message}`, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "speak") {
        const text = interaction.options.getString("text", true).trim();
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
          await interaction.reply({ content: "join a voice channel first and i'll speak in it.", ephemeral: true, allowedMentions: { parse: [] } });
          return;
        }
        await interaction.deferReply();
        try {
          const result = await speakInVoice(
            guildId,
            text,
            voiceChannel.id,
            interaction.channelId,
            interaction.guild?.shardId ?? 0,
            interaction.user.username,
          );
          if (result.ok) {
            await interaction.editReply({ content: `🔊 speaking: *"${text.slice(0, 100)}${text.length > 100 ? "…" : ""}"*`, allowedMentions: { parse: [] } });
          } else {
            await interaction.editReply({ content: `couldn't do the tts: ${result.reason ?? "unknown error"}`, allowedMentions: { parse: [] } });
          }
        } catch (err: any) {
          log(`[Slash:speak] ${err.message}`, "discord");
          await interaction.editReply({ content: `tts blew up: ${err.message}`, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "skip") {
        cancelDjFades(guildId);
        try {
          const result = await requestSkip(client!, guildId, interaction.user.id);
          await interaction.reply({ content: formatSkipReply(result), allowedMentions: { parse: [] } });
        } catch (err: any) {
          await interaction.reply({ content: `skip failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "stop") {
        try {
          onDjStop(guildId);
          const stopped = await stopMusic(guildId);
          await interaction.reply({
            content: stopped ? "stopped and disconnected." : "i wasn't even playing anything.",
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          await interaction.reply({ content: `stop failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "disconnect") {
        try {
          const done = await disconnectMusic(guildId);
          await interaction.reply({
            content: done ? "disconnected." : "i'm not in a voice channel.",
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          await interaction.reply({ content: `disconnect failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "reconnect") {
        await interaction.deferReply();
        try {
          const result = await reconnectMusic(guildId);
          if (result.ok) {
            const where = result.trackTitle
              ? `resumed **${result.trackTitle}**${result.resumedAt > 0 ? ` at ${formatDuration(result.resumedAt)}` : ""}`
              : "queue is empty, but reconnected";
            const node = result.nodeName ? ` (now on \`${result.nodeName}\`)` : "";
            await interaction.editReply({
              content: `reconnected to a fresh node${node} — ${where}.`,
              allowedMentions: { parse: [] },
            });
          } else {
            await interaction.editReply({
              content: `reconnect failed: ${result.message}`,
              allowedMentions: { parse: [] },
            });
          }
        } catch (err: any) {
          await interaction.editReply({ content: `reconnect failed: ${err.message}`, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "pause") {
        try {
          const paused = await pauseMusic(guildId);
          await interaction.reply({ content: paused ? "paused." : "nothing to pause.", allowedMentions: { parse: [] } });
        } catch (err: any) {
          await interaction.reply({ content: `pause failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "resume") {
        try {
          const resumed = await resumeMusic(guildId);
          await interaction.reply({ content: resumed ? "resumed." : "nothing to resume.", allowedMentions: { parse: [] } });
        } catch (err: any) {
          await interaction.reply({ content: `resume failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "queue") {
        const q = getQueue(guildId);
        if (!q || (!q.current && q.tracks.length === 0)) {
          await interaction.reply({ content: "queue is empty.", allowedMentions: { parse: [] } });
          return;
        }
        const lines: string[] = [];
        if (q.current) {
          const dur = q.current.isStream ? "LIVE" : formatDuration(q.current.duration);
          const pos = formatDuration(q.player.position);
          const loopLabel = q.loop !== "none" ? ` | loop: ${q.loop}` : "";
          lines.push(`**now playing:** ${q.current.title} [${pos}/${dur}] — req by ${q.current.requestedBy}${loopLabel}`);
        }
        if (q.tracks.length > 0) {
          lines.push("");
          lines.push("**up next:**");
          q.tracks.slice(0, 10).forEach((t, i) => {
            const dur = t.isStream ? "LIVE" : formatDuration(t.duration);
            lines.push(`${i + 1}. ${t.title} [${dur}] — req by ${t.requestedBy}`);
          });
          if (q.tracks.length > 10) lines.push(`…and ${q.tracks.length - 10} more`);
        }
        await interaction.reply({ content: lines.join("\n"), allowedMentions: { parse: [] } });
        return;
      }

      if (commandName === "nowplaying") {
        const q = getQueue(guildId);
        if (!q?.current) {
          await interaction.reply({ content: "nothing is playing.", allowedMentions: { parse: [] } });
          return;
        }
        await interaction.reply({
          embeds: [await buildNowPlayingEmbed(q.current, q)],
          components: [buildMusicButtons(q.player.paused)],
          allowedMentions: { parse: [] },
        });
        const sent = await interaction.fetchReply();
        scheduleNowPlayingProgressUpdates(sent, guildId, q.current);
        return;
      }

      if (commandName === "volume") {
        const vol = interaction.options.getInteger("level", true);
        cancelDjFades(guildId);
        try {
          const set = await setMusicVolume(guildId, vol);
          await interaction.reply({
            content: set ? `volume set to ${vol}%.` : "nothing is playing.",
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          await interaction.reply({ content: `volume failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "shuffle") {
        const done = shuffleQueue(guildId);
        await interaction.reply({
          content: done ? "queue shuffled." : "not enough tracks in the queue to shuffle.",
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (commandName === "loop") {
        const newMode = cycleLoop(guildId);
        if (newMode === null) {
          await interaction.reply({ content: "nothing is playing.", allowedMentions: { parse: [] } });
          return;
        }
        const labels: Record<string, string> = { none: "loop off", track: "looping current track", queue: "looping entire queue" };
        await interaction.reply({ content: labels[newMode] ?? newMode, allowedMentions: { parse: [] } });
        return;
      }

      if (commandName === "seek") {
        const timeStr = interaction.options.getString("time", true);
        const ms = parseSeekTime(timeStr);
        if (ms === null) {
          await interaction.reply({ content: "invalid time format. use `1:30` or `90` (seconds).", ephemeral: true, allowedMentions: { parse: [] } });
          return;
        }
        try {
          const done = await seekTrack(guildId, ms);
          await interaction.reply({
            content: done ? `seeked to ${formatDuration(ms)}.` : "can't seek — nothing playing or it's a livestream.",
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          await interaction.reply({ content: `seek failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "remove") {
        const idx = interaction.options.getInteger("position", true);
        const removed = removeTrack(guildId, idx);
        await interaction.reply({
          content: removed ? `removed **${removed.title}** from the queue.` : "no track at that position.",
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (commandName === "move") {
        const from = interaction.options.getInteger("from", true);
        const to = interaction.options.getInteger("to", true);
        const done = moveTrack(guildId, from, to);
        await interaction.reply({
          content: done ? `moved track from position ${from} to ${to}.` : "invalid positions.",
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (commandName === "clear") {
        const count = clearQueue(guildId);
        await interaction.reply({
          content: count > 0 ? `cleared ${count} track${count === 1 ? "" : "s"} from the queue.` : "queue was already empty.",
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (commandName === "savequeue") {
        const name = interaction.options.getString("name", true).trim();
        const q = getQueue(guildId);
        const tracks = q ? [q.current, ...q.tracks].filter(Boolean) as typeof q.tracks : [];
        if (!tracks.length) {
          await replyEph("nothing is playing — nothing to save.");
          return;
        }
        await interaction.deferReply();
        try {
          let playlist = await storage.getPlaylist(interaction.user.id, guildId, name);
          if (playlist) {
            await storage.setPlaylistTracks(playlist.id, tracks.map((t, i) => ({
              position: i,
              encoded: t.encoded,
              title: t.title,
              author: t.author,
              uri: t.uri,
              duration: t.duration,
              artworkUrl: t.artworkUrl ?? null,
            })));
          } else {
            playlist = await storage.createPlaylist(interaction.user.id, guildId, name);
            await storage.setPlaylistTracks(playlist.id, tracks.map((t, i) => ({
              position: i,
              encoded: t.encoded,
              title: t.title,
              author: t.author,
              uri: t.uri,
              duration: t.duration,
              artworkUrl: t.artworkUrl ?? null,
            })));
          }
          await interaction.editReply({
            content: `saved **${tracks.length}** track${tracks.length !== 1 ? "s" : ""} as playlist **${name}**.`,
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          log(`[Playlist:save] failed: ${err.message}`, "discord");
          await interaction.editReply({ content: `couldn't save playlist: ${err.message}`, allowedMentions: { parse: [] } }).catch(() => {});
        }
        return;
      }

      if (commandName === "playlist") {
        const sub = interaction.options.getSubcommand();
        if (sub === "list") {
          await interaction.deferReply({ ephemeral: true });
          try {
            const lists = await storage.getPlaylists(interaction.user.id, guildId);
            if (!lists.length) {
              await interaction.editReply({ content: "you have no saved playlists in this server. use `/savequeue <name>` to save one.", allowedMentions: { parse: [] } });
              return;
            }
            const lines = lists.map((p, i) => `${i + 1}. **${p.name}**`).join("\n");
            await interaction.editReply({ content: `**your playlists:**\n${lines}`, allowedMentions: { parse: [] } });
          } catch (err: any) {
            await interaction.editReply({ content: `error: ${err.message}`, allowedMentions: { parse: [] } }).catch(() => {});
          }
          return;
        }

        if (sub === "load") {
          const name = interaction.options.getString("name", true).trim();
          const voiceChannel = (interaction.guild?.members.cache.get(interaction.user.id))?.voice?.channel;
          if (!voiceChannel) {
            await replyEph("join a voice channel first.");
            return;
          }
          await interaction.deferReply();
          try {
            const playlist = await storage.getPlaylist(interaction.user.id, guildId, name);
            if (!playlist) {
              await interaction.editReply({ content: `no playlist named **${name}** found.`, allowedMentions: { parse: [] } });
              return;
            }
            const rows = await storage.getPlaylistTracks(playlist.id);
            if (!rows.length) {
              await interaction.editReply({ content: `playlist **${name}** is empty.`, allowedMentions: { parse: [] } });
              return;
            }
            const tracks: QueueTrack[] = rows.map((r) => ({
              encoded: r.encoded,
              title: r.title,
              author: r.author,
              uri: r.uri,
              duration: r.duration,
              isStream: false,
              requestedBy: interaction.user.username,
              artworkUrl: r.artworkUrl ?? null,
            }));
            const result = await joinAndPlayMultiple(guildId, voiceChannel.id, interaction.channelId, tracks, interaction.guild?.shardId ?? 0);
            await interaction.editReply({
              content: result === "playing"
                ? `playing playlist **${name}** — ${tracks.length} tracks.`
                : `queued playlist **${name}** — ${tracks.length} tracks added.`,
              allowedMentions: { parse: [] },
            });
          } catch (err: any) {
            log(`[Playlist:load] failed: ${err.message}`, "discord");
            await interaction.editReply({ content: `couldn't load playlist: ${err.message}`, allowedMentions: { parse: [] } }).catch(() => {});
          }
          return;
        }

        if (sub === "delete") {
          const name = interaction.options.getString("name", true).trim();
          await interaction.deferReply({ ephemeral: true });
          try {
            const deleted = await storage.deletePlaylist(interaction.user.id, guildId, name);
            await interaction.editReply({
              content: deleted ? `deleted playlist **${name}**.` : `no playlist named **${name}** found.`,
              allowedMentions: { parse: [] },
            });
          } catch (err: any) {
            await interaction.editReply({ content: `error: ${err.message}`, allowedMentions: { parse: [] } }).catch(() => {});
          }
          return;
        }
        return;
      }

      if (commandName === "autoplay") {
        const explicit = interaction.options.getBoolean("enabled", false);
        const desired = explicit !== null ? explicit : !isAutoplayEnabled(guildId);
        const result = setAutoplay(guildId, desired);
        await interaction.reply({
          content: result
            ? "🎶 autoplay **on** — i'll keep the vibe going with similar tracks when the queue runs out."
            : "autoplay **off** — i'll stop when the queue ends.",
          allowedMentions: { parse: [] },
        });
        return;
      }
    }

    // mode commands
    const modeCommandNames = Object.keys(BOT_MODES);
    if (modeCommandNames.includes(commandName) || commandName === "mode") {
      if (interaction.channelId !== MODE_CHANNEL_ID) {
        await replyEph("mode commands only work in the designated mode channel.");
        return;
      }
      if (commandName === "mode") {
        const had = interaction.guildId ? guildModes.get(interaction.guildId) : undefined;
        if (interaction.guildId) {
          guildModes.delete(interaction.guildId);
          await clearModeTheme(interaction.guildId);
        }
        clearAllHistory();
        await interaction.reply({
          content: had ? `${BOT_MODES[had]?.label ?? had} deactivated. back to normal.` : "no mode was active. already normal.",
          allowedMentions: { parse: [] },
        });
      } else {
        const mode = BOT_MODES[commandName];
        if (interaction.guildId) {
          guildModes.set(interaction.guildId, commandName);
          await applyModeTheme(interaction.guildId, commandName);
        }
        clearAllHistory();
        await interaction.reply({
          content: `${mode.label} activated serverwide. use \`/mode\` or \`?mode\` to turn it off.`,
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    // /rave and /ravestop
    if (commandName === "rave" || commandName === "ravestop") {
      const guildId = interaction.guildId;
      if (!guildId || !interaction.guild) {
        await replyEph("rave only works in servers.");
        return;
      }

      if (commandName === "ravestop") {
        onDjStop(guildId);
        const stopped = await stopMusic(guildId);
        await interaction.reply({
          content: stopped ? "rave stopped." : "rave wasn't running.",
          allowedMentions: { parse: [] },
        });
        return;
      }

      const genre = interaction.options.getString("genre", true).trim();
      const member = interaction.guild.members.cache.get(interaction.user.id);
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        await replyEph("join a voice channel first.");
        return;
      }

      await interaction.deferReply();
      try {
        const tracks = await resolveSearchResults(`${genre} music`, `rave:${genre}`, 10);
        if (!tracks.length) {
          await interaction.editReply({ content: `couldn't find any tracks for **${genre}**. try a different genre.`, allowedMentions: { parse: [] } });
          return;
        }
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        const tcId       = interaction.channelId ?? voiceChannel.id;
        const durationRaw = interaction.options.getString("duration") ?? null;
        const endsAt      = durationRaw ? parseDuration(durationRaw) : null;
        djSessions.set(guildId, {
          genre,
          vcId:             voiceChannel.id,
          tcId,
          lastTrackUri:     null,
          recentUris:       [],
          phase:            "warmup",
          totalTrackCount:  0,
          startedAt:        Date.now(),
          endsAt:           endsAt ? Date.now() + endsAt : null,
          playedTracks:     [],
          vibeShift:        false,
        });
        await joinAndPlayMultiple(guildId, voiceChannel.id, tcId, tracks, interaction.guild.shardId ?? 0);
        const durationNote = endsAt ? ` · ends in **${durationRaw}**` : " · auto-refills when queue runs low";
        await interaction.editReply({
          content: `🎧 **rave** · playing **${genre}**${durationNote}`,
          allowedMentions: { parse: [] },
        });
      } catch (err: any) {
        onDjStop(guildId);
        log(`[Slash:rave] failed: ${err.message}`, "discord");
        await interaction.editReply({ content: `couldn't start dj: ${err.message}`, allowedMentions: { parse: [] } }).catch(() => {});
      }
      return;
    }

    // dossier commands
    if (["dossview", "dossdelete", "dosswipe"].includes(commandName)) {
      if (!isOwner) {
        await replyEph("no. dossier commands are owner-only.");
        return;
      }
      const target = interaction.options.getUser("user", true);
      try {
        if (commandName === "dossview") {
          const memory = await storage.getUserMemory(target.id);
          const possibilities = memory?.dossier?.trim() || "(none)";
          const sureties = memory?.sureties?.trim() || "(none)";
          await replyEph([
            `memory record for ${target.tag}:`,
            "",
            "[confirmed / sureties]",
            sureties,
            "",
            "[inferred / possibilities]",
            possibilities,
          ].join("\n"));
          return;
        }
        const deleted = await storage.deleteUserMemory(target.id);
        if (commandName === "dosswipe") clearUserMemorySession(target.id);
        await replyEph(
          commandName === "dosswipe"
            ? `${target.tag}'s saved dossier ${deleted ? "and live memory were wiped." : "was already empty; live memory was wiped."}`
            : `${target.tag}'s saved dossier ${deleted ? "was deleted." : "was already empty."}`,
        );
      } catch (err: any) {
        log(`[Slash:dossier] Command failed: ${err.message}`, "discord");
        await replyEph(`dossier command failed: ${err.message}`);
      }
      return;
    }

    // dossier profile
    if (commandName === "dossier") {
      if (!interaction.guildId) {
        await replyEph("dossier only works in servers.");
        return;
      }
      const target = interaction.options.getUser("user", false) ?? interaction.user;
      const targetMember = interaction.guild?.members.cache.get(target.id);
      const targetName = targetMember?.displayName ?? target.username;
      await interaction.deferReply();
      try {
        const profile = await buildUserDossier(target.id, interaction.guildId, targetName);
        await interaction.editReply({
          content: profile ?? "dossier engine is offline. try again later.",
          allowedMentions: { parse: [] },
        });
      } catch (err: any) {
        log(`[Slash:dossier] Failed: ${err.message}`, "discord");
        try { await interaction.editReply({ content: "dossier build broke. somehow.", allowedMentions: { parse: [] } }); } catch {}
      }
      return;
    }

    // lyrics / history
    if (commandName === "lyrics" || commandName === "history") {
      const guildId = interaction.guildId;
      if (!guildId) {
        await replyEph("this command only works in servers.");
        return;
      }

      if (commandName === "history") {
        const hist = trackHistory.get(guildId);
        if (!hist || hist.length === 0) {
          await interaction.reply({ content: "no tracks played yet this session.", allowedMentions: { parse: [] } });
          return;
        }
        const lines = hist.map((t, i) => {
          const dur = formatDuration(t.duration);
          const ago = Math.floor((Date.now() - t.playedAt) / 60000);
          const agoStr = ago < 1 ? "just now" : ago === 1 ? "1 min ago" : `${ago} min ago`;
          return `${i + 1}. **${t.title}** by ${t.author} [${dur}] — req by ${t.requestedBy} · ${agoStr}`;
        });
        await interaction.reply({ content: `**recently played:**\n${lines.join("\n")}`, allowedMentions: { parse: [] } });
        return;
      }

      // lyrics
      await interaction.deferReply();
      let lyricsArtist = "";
      let lyricsTitle = "";
      const songArg = interaction.options.getString("song", false);
      if (songArg) {
        const dashIdx = songArg.indexOf(" - ");
        if (dashIdx !== -1) {
          lyricsArtist = songArg.slice(0, dashIdx).trim();
          lyricsTitle = songArg.slice(dashIdx + 3).trim();
        } else {
          lyricsArtist = songArg.trim();
          lyricsTitle = songArg.trim();
        }
      } else {
        const q = getQueue(guildId);
        if (q?.current) {
          lyricsArtist = q.current.author;
          lyricsTitle = q.current.title;
        }
      }
      if (!lyricsArtist && !lyricsTitle) {
        await interaction.editReply({ content: "nothing is playing. provide a song with `/lyrics artist - title`.", allowedMentions: { parse: [] } });
        return;
      }
      const lyrics = await fetchLyrics(lyricsArtist, lyricsTitle);
      if (!lyrics) {
        await interaction.editReply({ content: `couldn't find lyrics for **${lyricsTitle}**${lyricsArtist !== lyricsTitle ? ` by ${lyricsArtist}` : ""}. try formatting as \`artist - title\`.`, allowedMentions: { parse: [] } });
        return;
      }
      const header = `**${lyricsTitle}**${lyricsArtist !== lyricsTitle ? ` by ${lyricsArtist}` : ""}\n\n`;
      const maxLyrics = 2000 - header.length - 6;
      const truncated = lyrics.length > maxLyrics;
      const displayLyrics = truncated ? lyrics.slice(0, maxLyrics) + "\n…" : lyrics;
      await interaction.editReply({ content: header + displayLyrics, allowedMentions: { parse: [] } });
      return;
    }

    // AI commands
    if (["fred", "poem", "roast", "explain", "translate", "tldr", "rate", "8ball", "ship", "hottake", "compliment", "debate"].includes(commandName)) {
      const cd = checkAiCooldown(interaction.user.id);
      if (!cd.ok) {
        await interaction.reply({ content: `slow down — ${cd.remaining}s cooldown remaining.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      await interaction.deferReply();
      try {
        let taskPrompt: string;

        if (commandName === "tldr") {
          const channel = interaction.channel as TextChannel | null;
          if (!channel) {
            await interaction.editReply({ content: "can't access this channel.", allowedMentions: { parse: [] } });
            return;
          }
          const fetched = await channel.messages.fetch({ limit: 50 });
          const humanMessages = fetched
            .filter((m) => !m.author.bot)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          const chatSummary = humanMessages.size === 0
            ? "[no recent messages — the channel is completely dead]"
            : humanMessages.map((m) => `${m.author.username}: ${m.content}`).join("\n");
          taskPrompt = `summarize the following chat in your style — concise, sharp, no padding. do not quote or repeat any messages verbatim. then on a new line, describe the current vibe in one sarcastic sentence. all lowercase, no emojis. output only your summary and vibe line, nothing else.\n\nchat log:\n${chatSummary}`;
        } else if (commandName === "fred") {
          const msg = interaction.options.getString("message", true);
          const reply = await askGemini(msg, authorDisplayName, interaction.channelId, authorContext);
          if (reply) {
            await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
            pushChannelMessage(interaction.channelId, "fred", reply, true);
            triggerUserMemoryUpdate(interaction.user.id);
          } else {
            await interaction.editReply({ content: "something went wrong on my end.", allowedMentions: { parse: [] } });
          }
          return;
        } else if (commandName === "poem") {
          const topic = interaction.options.getString("topic", true);
          taskPrompt = `write a poem about: ${topic}. make it actually good. keep your personality in it — sharp, darkly funny where appropriate, no sappy crap unless the topic demands it.`;
        } else if (commandName === "roast") {
          const target = interaction.options.getString("target", true);
          taskPrompt = `roast this person/thing/idea as brutally and wittily as possible: ${target}. go all out. be creative, specific, and devastating.`;
        } else if (commandName === "explain") {
          const topic = interaction.options.getString("topic", true);
          taskPrompt = `explain this thoroughly and accurately: ${topic}. be as detailed as the topic warrants. still in your voice, but actually useful.`;
        } else if (commandName === "rate") {
          const thing = interaction.options.getString("thing", true);
          taskPrompt = `rate "${thing}" out of 10. give a specific score like 7.3/10 or 2/10 — no round numbers unless it truly deserves them. explain your rating in 2-3 sharp sentences. be honest and opinionated. start your response with just the score.`;
        } else if (commandName === "8ball") {
          const question = interaction.options.getString("question", true);
          taskPrompt = `the user asked the magic 8 ball: "${question}". give a magic 8 ball style answer, but in your voice as fred — a slightly sarcastic oracle who's seen too much. pick one definitive answer and commit to it. one or two sentences max.`;
        } else if (commandName === "ship") {
          const person1 = interaction.options.getString("person1", true);
          const person2 = interaction.options.getString("person2", true);
          taskPrompt = `rate the romantic compatibility between ${person1} and ${person2}. give a compatibility percentage like "64%" — make it a weird specific number. analyze why they would or wouldn't work together in 2-3 sentences. be entertaining and honest. start with the percentage.`;
        } else if (commandName === "hottake") {
          const topic = interaction.options.getString("topic", false);
          taskPrompt = topic
            ? `deliver a spicy, controversial hot take about: ${topic}. be bold, specific, and willing to defend it. 1-3 sentences, no hedging, no "some people think" — own it.`
            : `deliver a completely unprompted spicy, controversial hot take about anything — music, food, culture, technology, society, whatever. be bold, specific, and willing to defend it. 1-3 sentences, no hedging.`;
        } else if (commandName === "compliment") {
          const user = interaction.options.getString("user", true);
          taskPrompt = `give ${user} a compliment, but make it subtly backhanded — the kind that sounds nice at first but has a sting in the tail. be witty about it, not mean-spirited. 1-2 sentences.`;
        } else if (commandName === "debate") {
          const topic = interaction.options.getString("topic", true);
          taskPrompt = `pick a side on the following topic and argue it convincingly in 3-5 sentences: "${topic}". don't be neutral — commit to your position fully. be persuasive, specific, and a little provocative.`;
        } else {
          // translate
          const lang = interaction.options.getString("language", true);
          const text = interaction.options.getString("text", true);
          taskPrompt = `translate the following text to ${lang}. output only the translation, nothing else.\n\n${text}`;
        }

        const reply = await askGemini(taskPrompt, authorDisplayName, interaction.channelId, authorContext);
        if (reply) {
          await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
          pushChannelMessage(interaction.channelId, "fred", reply, true);
          triggerUserMemoryUpdate(interaction.user.id);
        } else {
          await interaction.editReply({ content: "something went wrong on my end.", allowedMentions: { parse: [] } });
        }
      } catch (err: any) {
        log(`[Slash:${commandName}] Failed: ${err.message}`, "discord");
        try { await interaction.editReply({ content: "something broke. try again.", allowedMentions: { parse: [] } }); } catch {}
      }
      return;
    }
  });

  client.on("guildCreate", (guild) => {
    if (botState.online) {
      botState.guildCount = client?.guilds.cache.size ?? botState.guildCount;
      guild.commands.set(SLASH_COMMANDS).catch((e: any) =>
        log(`Failed to register slash commands in new guild ${guild.name}: ${e.message}`, "discord"),
      );
    }
  });

  client.on("guildDelete", () => {
    if (botState.online) {
      botState.guildCount = client?.guilds.cache.size ?? botState.guildCount;
    }
  });

  client.on("shardDisconnect", (_event, shardId) => {
    log(`Shard ${shardId} disconnected from gateway.`, "discord");
    lastDiscordDisconnectAt = Date.now();
    botState.online = false;
    botState.status = "offline";
  });

  client.on("shardReconnecting", (shardId) => {
    log(`Shard ${shardId} reconnecting to gateway…`, "discord");
    lastDiscordDisconnectAt ??= Date.now();
    botState.status = "reconnecting";
  });

  client.on("shardResume", (shardId, replayedEvents) => {
    log(`Shard ${shardId} resumed (replayed ${replayedEvents} events).`, "discord");
    lastDiscordDisconnectAt = null;
    if (client?.user) {
      botState.online = true;
      botState.status = "online";
      botState.guildCount = client.guilds.cache.size;
      botState.lastError = null;
    }
  });

  client.on("error", (err) => {
    log(`Discord client error: ${err.message}`, "discord");
    botState.lastError = err.message;
  });

  client.on("shardError", (err, shardId) => {
    log(`Shard ${shardId} error: ${err.message}`, "discord");
    botState.lastError = err.message;
  });

  client.on("invalidated", () => {
    log("Discord session invalidated — restarting client.", "discord");
    botState.online = false;
    botState.status = "reconnecting";
    lastDiscordDisconnectAt = Date.now() - 120_000;
  });

  // Guilds where music was auto-paused because Fred was left alone in the VC
  const autoPausedGuilds = new Set<string>();
  // Per-guild timers that fire a disconnect after 2 min of being alone
  const aloneDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  client.on("voiceStateUpdate", async (oldState, newState) => {
    const botId = client?.user?.id;
    if (!botId) return;

    // Ignore the bot's own voice state changes
    if (oldState.id === botId || newState.id === botId) return;

    const guildId = oldState.guild?.id ?? newState.guild?.id;
    if (!guildId) return;

    const queue = getQueue(guildId);
    if (!queue) return;

    const leftChannelId = oldState.channelId;
    const joinedChannelId = newState.channelId;

    // A human joined the VC Fred is in
    if (joinedChannelId === queue.voiceChannelId) {
      const timer = aloneDisconnectTimers.get(guildId);
      if (timer) {
        clearTimeout(timer);
        aloneDisconnectTimers.delete(guildId);
        if (autoPausedGuilds.has(guildId)) {
          autoPausedGuilds.delete(guildId);
          await resumeMusic(guildId);
          const ch = client?.channels.cache.get(queue.textChannelId) as TextChannel | null;
          ch?.send({ content: "someone's back — resuming.", allowedMentions: { parse: [] } }).catch(() => {});
        }
      }
      return;
    }

    // A human left the VC Fred is in
    if (leftChannelId === queue.voiceChannelId) {
      const guild = oldState.guild;
      const channel = guild.channels.cache.get(leftChannelId);
      if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return;

      const humanCount = channel.members.filter((m) => !m.user.bot).size;
      if (humanCount > 0) return; // other humans still present

      // Pause if currently playing (and not already paused)
      if (queue.current && !queue.player.paused) {
        await pauseMusic(guildId);
        autoPausedGuilds.add(guildId);
      }

      // Clear any existing timer before setting a new one
      const existing = aloneDisconnectTimers.get(guildId);
      if (existing) clearTimeout(existing);

      const ch = client?.channels.cache.get(queue.textChannelId) as TextChannel | null;
      ch?.send({ content: "everyone left the vc. pausing — if no one's back in 2 minutes i'm out.", allowedMentions: { parse: [] } }).catch(() => {});

      const timer = setTimeout(async () => {
        aloneDisconnectTimers.delete(guildId);
        autoPausedGuilds.delete(guildId);
        // Capture the text channel before disconnecting
        const q = getQueue(guildId);
        const notifCh = q ? (client?.channels.cache.get(q.textChannelId) as TextChannel | null) : null;
        await disconnectMusic(guildId);
        notifCh?.send({ content: "no one came back. disconnected.", allowedMentions: { parse: [] } }).catch(() => {});
        log(`[Music] Auto-disconnected from guild ${guildId} — empty VC for 2 minutes.`, "discord");
      }, 2 * 60 * 1000);
      timer.unref?.();
      aloneDisconnectTimers.set(guildId, timer);
    }
  });

  // ─── New member greeting ───────────────────────────────────────────────────
  client.on("guildMemberAdd", async (member) => {
    if (member.user.bot) return;
    const guild = member.guild;

    // Find the best welcome channel: prefer a channel named "general", then system channel
    const generalChannel = (
      guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          (ch.name.toLowerCase() === "general" ||
            ch.name.toLowerCase() === "general-chat" ||
            ch.name.toLowerCase() === "general-discussion"),
      ) ??
      guild.systemChannel ??
      null
    ) as TextChannel | null;

    if (!generalChannel) return;

    const displayName = member.displayName;
    try {
      const greeting = await askGemini(
        `A new member named "${displayName}" just joined the server. Welcome them in your voice — warm but dry, not sappy, not cringe. Include their @mention: <@${member.user.id}>. Optionally drop one natural Dutch word or phrase if it fits. 1-2 sentences max.`,
        "system",
        generalChannel.id,
        {
          userId: "system",
          roles: [],
          sortedRoles: [],
          isOwner: false,
          guildName: guild.name,
          guildId: guild.id,
          channelName: generalChannel.name,
        },
      );

      const fallbacks = [
        `welkom, <@${member.user.id}>. glad you made it.`,
        `<@${member.user.id}> is here. finally.`,
        `oh look, <@${member.user.id}> decided to show up. welkom.`,
        `<@${member.user.id}> just walked in. respect the vibe.`,
      ];
      const msg = greeting ?? fallbacks[Math.floor(Math.random() * fallbacks.length)];

      await generalChannel.send({
        content: msg,
        allowedMentions: { users: [member.user.id], parse: [] },
      });
      log(`[Welcome] Greeted ${displayName} in #${generalChannel.name}`, "discord");
    } catch (err: any) {
      log(`[Welcome] Failed to greet ${displayName}: ${err.message}`, "discord");
    }
  });

  try {
    log("Attempting Discord login…", "discord");
    await client.login(rawToken);
  } catch (err: any) {
    const msg: string = err.message ?? String(err);

    if (/disallowed intents/i.test(msg) || /DISALLOWED_INTENTS/i.test(msg)) {
      if (_messageContentEnabled) {
        log("MessageContent intent is not enabled in Discord Developer Portal — retrying without it. Bot will still respond to @mentions and prefix commands.", "discord");
        _messageContentEnabled = false;
        client.destroy();
        client = null;
        return startBot();
      }
    }

    let friendlyError = msg;
    if (/invalid token/i.test(msg)) {
      friendlyError = "Invalid token — check the TOKEN value on Render. It may have whitespace, be truncated, or was reset again. Grab a fresh copy from Discord Developer Portal → Bot → Reset Token.";
    } else if (/disallowed intents/i.test(msg) || /DISALLOWED_INTENTS/i.test(msg)) {
      friendlyError = "Intents blocked — go to Discord Developer Portal → your app → Bot → Privileged Gateway Intents and enable 'Message Content Intent', then Save Changes and redeploy.";
    } else if (/token was reset/i.test(msg)) {
      friendlyError = "Token was reset by Discord — grab the new token and update the TOKEN env var on Render, then redeploy.";
    } else if (/429|rate limit/i.test(msg)) {
      friendlyError = "Rate limited by Discord — too many login attempts. Wait a few minutes, it will retry automatically.";
    }

    log(`Login failed: ${friendlyError}`, "discord");
    botState.lastError = friendlyError;
    botState.online = false;
    botState.status = "error";

    const RETRY_DELAY_MS = 30_000;
    log(`Retrying login in ${RETRY_DELAY_MS / 1000}s…`, "discord");
    loginRetryTimer = setTimeout(() => startBot(), RETRY_DELAY_MS);
    loginRetryTimer.unref?.();
  }
}
