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
} from "discord.js";
import { log } from "./index";
import { getIO, getLiveViewerCount } from "./socket";
import { askGemini, askGeminiWithImage, clearUserMemorySession, clearAllHistory, getAIStats, triggerUserMemoryUpdate, generateBotStatus, queuePassiveWatch, isPassiveWatchCandidate, pushChannelMessage, type ImageData } from "./gemini";
import { searchWeb, formatSearchResultsForAI, detectSearchIntent } from "./search";
import { startQotd, stopQotd } from "./qotd";
import { storage } from "./storage";
import { announceVersionOnStartup, getVersionString } from "./version";
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
  type QueueTrack,
  type GuildQueue,
} from "./music";

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

// ─── Music embed helpers ────────────────────────────────────────────────────

const EMBED_COLOR = 0xE50914;
const SPOTIFY_PROGRESS_SEGMENTS = 12;
const SPOTIFY_PROGRESS_UPDATE_MS = 1000;

interface AlbumArtResult {
  imageUrl: string;
}

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

async function fetchItunesAlbumArt(track: QueueTrack): Promise<AlbumArtResult | null> {
  const title = cleanSearchText(track.title);
  const artist = cleanSearchText(track.author);
  const term = artist ? `${artist} ${title}` : title;

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "5");
  url.searchParams.set("term", term);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      log(`[iTunes] Track search failed with ${response.status}.`, "discord");
      return null;
    }

    const data = await response.json() as {
      results?: Array<{ artworkUrl100?: string }>;
    };

    const hit = data.results?.find((r) => r.artworkUrl100);
    if (!hit?.artworkUrl100) return null;

    const imageUrl = hit.artworkUrl100.replace("100x100bb", "600x600bb");
    return { imageUrl };
  } catch (err: any) {
    log(`[iTunes] Track search failed: ${err.message}`, "discord");
    return null;
  }
}

function getAlbumArt(track: QueueTrack): Promise<AlbumArtResult | null> {
  const key = `${track.title.toLowerCase()}::${track.author.toLowerCase()}`;
  const cached = albumArtCache.get(key);
  if (cached) return cached;

  const pending = fetchItunesAlbumArt(track).then((result) => {
    if (!result) albumArtCache.delete(key);
    return result;
  });
  albumArtCache.set(key, pending);
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

  const scheduleNext = () => {
    const t = setTimeout(async () => {
      const queue = getQueue(guildId);
      if (!queue?.current || queue.current.encoded !== track.encoded) {
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
  );
}

// ────────────────────────────────────────────────────────────────────────────

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

const DEAD_CHAT_CHANNEL_ID = "1484056100654551133";
const DEAD_CHAT_INTERVAL_MS = 1_800_000;
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

const deadChatState = {
  mutedUntilHumanActivity: false,
  lastDeadMessageTimestamp: null as number | null,
};

function getRandomDeadChatMessage(): string {
  return DEAD_CHAT_MESSAGES[Math.floor(Math.random() * DEAD_CHAT_MESSAGES.length)];
}

async function startDeadChatChecker(readyClient: Client) {
  const runCheck = async () => {
    try {
      const channel = await readyClient.channels.fetch(DEAD_CHAT_CHANNEL_ID);
      if (
        !channel ||
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement)
      ) {
        log("[DeadChat] Could not fetch lounge channel.", "discord");
        return;
      }

      const textChannel = channel as TextChannel;
      const fetched = await textChannel.messages.fetch({ limit: 20 });
      const humanMessages = fetched.filter((m) => !m.author.bot);
      const latestHumanMessage = humanMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first();

      if (deadChatState.mutedUntilHumanActivity) {
        if (
          latestHumanMessage &&
          (!deadChatState.lastDeadMessageTimestamp ||
            latestHumanMessage.createdTimestamp > deadChatState.lastDeadMessageTimestamp)
        ) {
          deadChatState.mutedUntilHumanActivity = false;
          deadChatState.lastDeadMessageTimestamp = null;
          log("[DeadChat] Human activity resumed — dead chat checker unmuted.", "discord");
        } else {
          log("[DeadChat] Still no activity — staying muted.", "discord");
        }
        return;
      }

      const cutoff = Date.now() - DEAD_CHAT_INTERVAL_MS;
      const recentHumanMessage = latestHumanMessage && latestHumanMessage.createdTimestamp > cutoff;

      if (recentHumanMessage) {
        log("[DeadChat] Chat is active — no dead-chat message needed.", "discord");
        return;
      }

      const msg = getRandomDeadChatMessage();
      const sentMessage = await textChannel.send({
        content: msg,
        allowedMentions: { parse: [] },
      });

      deadChatState.lastDeadMessageTimestamp = sentMessage.createdTimestamp;
      deadChatState.mutedUntilHumanActivity = true;
      log(`[DeadChat] Dead-chat message sent: "${msg}"`, "discord");
    } catch (err: any) {
      log(`[DeadChat] Error: ${err.message}`, "discord");
    }
  };

  trackBackgroundTimer(setInterval(runCheck, DEAD_CHAT_INTERVAL_MS));
  log("[DeadChat] Dead chat checker started — fires every 30 minutes.", "discord");
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
    startDeadChatChecker(readyClient);
    startStatusShuffle(readyClient);
    initMusic(readyClient);
    setNowPlayingCallback((guildId, track, queue) => {
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
    startBotWatchdog();
    void announceVersionOnStartup(readyClient);

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

    if (message.channelId === DEAD_CHAT_CHANNEL_ID) {
      deadChatState.lastDeadMessageTimestamp = null;
      deadChatState.mutedUntilHumanActivity = false;
      log("[DeadChat] Human activity detected in lounge — dead-chat mute reset.", "discord");
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
    const isOwner = roleNames.some((role) => role.trim().toLowerCase() === "owner");
    const activeModeKey = message.guildId ? guildModes.get(message.guildId) : undefined;
    const activeModeInstruction = activeModeKey ? BOT_MODES[activeModeKey]?.instruction : undefined;

    // Track all channel messages for context (push before building context below)
    if (message.content.trim()) {
      pushChannelMessage(message.channelId, authorDisplayName, message.content.trim(), false);
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

    const authorContext = { userId: message.author.id, roles: roleNames, sortedRoles: sortedRoleNames, isOwner, guildName, channelName, modeInstruction: activeModeInstruction, replyTo };

    // Any message starting with a known ? or ! command should never trigger passive watch
    const isAnyCommand = /^[!?](fred|status|help|ping|tldr|poem|roast|explain|translate|search|play|playtop|skip|stop|pause|resume|queue|np|volume|shuffle|loop|repeat|remove|move|clear|disconnect|leave|seek|uwu|boomer|pirate|nerd|overlord|mode|normal|dossview|dossdelete|dosswipe|qotd)\b/i.test(rawContent);

    // Treat as directed at the bot if: user said "fred" by name, or replied to a bot message
    const isNamedFred = /\bfred\b/i.test(rawContent);
    const isDirectedAtBot = isNamedFred || isReplyToBot;

    if (!isMentioned && !isPrefixed && !isDirectedAtBot && !isAnyCommand && message.guildId) {
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
          `version: ${getVersionString()}`,
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

    // --- ?search command ---
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

    // --- music commands ---
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
          const skipped = await skipTrack(guildId);
          await message.reply({
            content: skipped ? `skipped **${skipped.title}**.` : "nothing is playing.",
            allowedMentions: { parse: [], repliedUser: false },
          });
        } catch (err: any) {
          await message.reply({ content: `skip failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "stop") {
        try {
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

      if (musicCmd === "pause") {
        try {
          const paused = await pauseMusic(guildId);
          await message.reply({
            content: paused ? "paused." : "nothing to pause.",
            allowedMentions: { parse: [], repliedUser: false },
          });
        } catch (err: any) {
          await message.reply({ content: `pause failed: ${err.message}`, allowedMentions: { parse: [], repliedUser: false } });
        }
        return;
      }

      if (musicCmd === "resume") {
        try {
          const resumed = await resumeMusic(guildId);
          await message.reply({
            content: resumed ? "resumed." : "nothing to resume.",
            allowedMentions: { parse: [], repliedUser: false },
          });
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
    // --- autocomplete handler ---
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

    // ─── Music button handler ───────────────────────────────────────────────
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
        const skipped = await skipTrack(guildId);
        await interaction.update({
          content: `⏭  Skipped **${skipped?.title ?? "track"}**.`,
          embeds: [],
          components: [],
        });
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

      return;
    }
    // ────────────────────────────────────────────────────────────────────────

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
    const isOwner = roleNames.some((r) => r.trim().toLowerCase() === "owner");
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
      channelName,
      modeInstruction: activeModeInstruction,
    };

    const replyEph = (content: string) =>
      interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });

    // --- ping ---
    if (commandName === "ping") {
      const start = Date.now();
      await interaction.reply({ content: "pong.", allowedMentions: { parse: [] } });
      await interaction.editReply(`pong. roundtrip: **${Date.now() - start}ms** | ws: **${client?.ws.ping ?? -1}ms**`);
      return;
    }

    // --- status ---
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
          "",
          `version: ${getVersionString()}`,
        ].join("\n"),
        allowedMentions: { parse: [] },
      });
      return;
    }

    // --- help ---
    if (commandName === "help") {
      const isModeChannel = interaction.channelId === MODE_CHANNEL_ID;
      const slashMember = interaction.guild?.members.cache.get(interaction.user.id);
      const userInVoice = !!slashMember?.voice?.channel;
      const slashChName = channelName.toLowerCase();
      const isMusicChannel = userInVoice || /\b(bot|bots|command|commands|music|audio|vc|voice)\b/.test(slashChName);

      const slashHelpLines: string[] = [
        "**commands** (use `/` or `?` prefix)",
        "`/status` — current model, token usage, uptime",
        "`/help` — this list",
        "`/ping` — check if the bot is alive",
        "`/tldr` — summarize recent chat and check the vibe",
        "`/poem <topic>` — write a poem about something",
        "`/roast <target>` — roast a person, thing, or idea",
        "`/explain <topic>` — explain something in depth",
        "`/translate <language> <text>` — translate text",
        "`?search <query>` — search the web and get an answer",
        "`/fred <message>` — talk to the ai",
        `or just ping <@${client?.user?.id}> with your message`,
        "or attach an image/video to any message to get a description",
      ];

      if (isMusicChannel) {
        slashHelpLines.push(
          "",
          "**music commands**",
          "`/play <query>` — play a song (or `?play`)",
          "`/skip` — skip current track",
          "`/stop` — stop and disconnect",
          "`/pause` / `/resume` — pause or resume",
          "`/queue` — show the queue",
          "`/nowplaying` — show current track",
          "`/volume <0-100>` — set volume",
        );
      }

      if (isModeChannel) {
        slashHelpLines.push(
          "",
          "**mode commands**",
          "`/uwu` — uwu speak mode",
          "`/boomer` — boomer mode",
          "`/pirate` — pirate mode",
          "`/nerd` — stereotypical nerd mode",
          "`/overlord` — megalomaniac AI mode",
          "`/mode` — turn off current mode",
        );
      }

      if (!isMusicChannel && !isModeChannel) {
        slashHelpLines.push("", "*music commands available in bot/voice channels. mode commands available in the mode channel.*");
      } else if (!isMusicChannel) {
        slashHelpLines.push("", "*music commands available in bot/voice channels.*");
      } else if (!isModeChannel) {
        slashHelpLines.push("", "*mode commands available in the mode channel.*");
      }

      await interaction.reply({
        content: slashHelpLines.join("\n"),
        allowedMentions: { parse: [] },
      });
      return;
    }

    // --- music slash commands ---
    const MUSIC_SLASH_CMDS = ["play", "playtop", "skip", "stop", "disconnect", "pause", "resume", "queue", "nowplaying", "volume", "shuffle", "loop", "seek", "remove", "move", "clear"];
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

      if (commandName === "skip") {
        try {
          const skipped = await skipTrack(guildId);
          await interaction.reply({
            content: skipped ? `skipped **${skipped.title}**.` : "nothing is playing.",
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          await interaction.reply({ content: `skip failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "stop") {
        try {
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

      if (commandName === "pause") {
        try {
          const paused = await pauseMusic(guildId);
          await interaction.reply({
            content: paused ? "paused." : "nothing to pause.",
            allowedMentions: { parse: [] },
          });
        } catch (err: any) {
          await interaction.reply({ content: `pause failed: ${err.message}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        return;
      }

      if (commandName === "resume") {
        try {
          const resumed = await resumeMusic(guildId);
          await interaction.reply({
            content: resumed ? "resumed." : "nothing to resume.",
            allowedMentions: { parse: [] },
          });
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
    }

    // --- mode commands ---
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

    // --- dossier commands ---
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

    // --- AI commands ---
    if (["fred", "poem", "roast", "explain", "translate", "tldr"].includes(commandName)) {
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

    // --- A human joined the VC Fred is in ---
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

    // --- A human left the VC Fred is in ---
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
