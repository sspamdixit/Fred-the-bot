import { log } from "./index";
import { joinAndPlayMultiple, getQueue, getIdealLavalinkNode, type QueueTrack } from "./music";
import type { Player } from "shoukaku";
import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const FADE_IN_MS  = 1_400;
const FADE_OUT_MS = 2_000;
const FADE_STEPS  = 28;

// ── phases ────────────────────────────────────────────────────────────────────
export type RavePhase = "warmup" | "peak" | "afterhours" | "cooldown";

const PHASE_TRACK_THRESHOLDS = { warmup: 4, peak: 12, afterhours: 20 };

const PHASE_SEARCH_PREFIX: Record<RavePhase, (genre: string) => string> = {
  warmup:     (g) => `chill ${g}`,
  peak:       (g) => `${g} bangers hype`,
  afterhours: (g) => `${g}`,
  cooldown:   (g) => `slow ${g} late night`,
};

export const PHASE_LABEL: Record<RavePhase, string> = {
  warmup:     "🌅 warm-up",
  peak:       "🔥 peak",
  afterhours: "🌙 after-hours",
  cooldown:   "🌌 cool-down",
};

const PHASE_COLOR: Record<RavePhase, number> = {
  warmup:     0x44aaff,
  peak:       0xff4400,
  afterhours: 0xff8800,
  cooldown:   0x6633cc,
};

function computePhase(totalTrackCount: number): RavePhase {
  if (totalTrackCount < PHASE_TRACK_THRESHOLDS.warmup)     return "warmup";
  if (totalTrackCount < PHASE_TRACK_THRESHOLDS.peak)       return "peak";
  if (totalTrackCount < PHASE_TRACK_THRESHOLDS.afterhours) return "afterhours";
  return "cooldown";
}

// ── session ───────────────────────────────────────────────────────────────────
export interface DjSession {
  genre: string;
  vcId: string;
  tcId: string;
  lastTrackUri: string | null;
  recentUris: string[];
  phase: RavePhase;
  totalTrackCount: number;
  startedAt: number;
  endsAt: number | null;
  playedTracks: Array<{ title: string; author: string }>;
  vibeShift: boolean;
}

export const djSessions = new Map<string, DjSession>();

const fadeOutTimers  = new Map<string, ReturnType<typeof setTimeout>>();
const fadeIntervals  = new Map<string, ReturnType<typeof setInterval>>();

// ── status ─────────────────────────────────────────────────────────────────
export interface DjTrackInfo {
  title: string;
  author: string;
  artworkUrl: string | null;
  duration: number;
  position: number;
}

export interface DjSessionStatus {
  guildId: string;
  genre: string;
  phase: RavePhase;
  currentTrack: DjTrackInfo | null;
  queueLength: number;
  timeRemaining: number | null;
}

export function getDjStatus(): DjSessionStatus[] {
  return [...djSessions.entries()].map(([guildId, s]) => {
    const q = getQueue(guildId);
    let currentTrack: DjTrackInfo | null = null;
    if (q?.current) {
      currentTrack = {
        title:      q.current.title,
        author:     q.current.author,
        artworkUrl: q.current.artworkUrl ?? null,
        duration:   q.current.duration,
        position:   Math.max(0, Number(q.player.position) || 0),
      };
    }
    return {
      guildId,
      genre:         s.genre,
      phase:         s.phase,
      currentTrack,
      queueLength:   q?.tracks.length ?? 0,
      timeRemaining: s.endsAt ? Math.max(0, s.endsAt - Date.now()) : null,
    };
  });
}

// ── discord client ref ────────────────────────────────────────────────────────
let raveClient: Client | null = null;
export function setRaveClient(c: Client): void { raveClient = c; }

// ── fades ─────────────────────────────────────────────────────────────────────
function cancelFades(guildId: string): void {
  const t = fadeOutTimers.get(guildId);
  if (t) { clearTimeout(t);  fadeOutTimers.delete(guildId); }
  const iv = fadeIntervals.get(guildId);
  if (iv) { clearInterval(iv); fadeIntervals.delete(guildId); }
}

export function cancelDjFades(guildId: string): void { cancelFades(guildId); }

function runFade(
  player: Player,
  fromVol: number,
  toVol: number,
  durationMs: number,
  guildId: string,
  trackFadeInterval: boolean,
): void {
  const stepMs = Math.max(20, Math.floor(durationMs / FADE_STEPS));
  const delta  = (toVol - fromVol) / FADE_STEPS;
  let step = 0;

  if (trackFadeInterval) {
    const prev = fadeIntervals.get(guildId);
    if (prev) clearInterval(prev);
  }

  const iv = setInterval(() => {
    step++;
    const vol = Math.round(fromVol + delta * step);
    player.setGlobalVolume(Math.max(0, Math.min(1000, vol))).catch(() => {});
    if (step >= FADE_STEPS) {
      clearInterval(iv);
      if (trackFadeInterval) fadeIntervals.delete(guildId);
    }
  }, stepMs);

  if (trackFadeInterval) fadeIntervals.set(guildId, iv);
}

// ── commentary ─────────────────────────────────────────────────────────────────
async function generateRaveQuip(
  genre: string,
  trackTitle: string,
  phase: RavePhase,
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const ai    = new GoogleGenerativeAI(key);
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const prompt =
      `You are Fred, a Discord music bot with a dry, confident Dutch personality. ` +
      `You just queued "${trackTitle}" in a ${genre} rave session (phase: ${phase}). ` +
      `Write ONE short DJ comment, max 12 words, lowercase, no quotes, no emoji. ` +
      `Be witty and in-character. Don't say "fred" or refer to yourself.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim() || null;
  } catch {
    return null;
  }
}

// ── vibe vote ──────────────────────────────────────────────────────────────────
async function runVibeVote(
  channel: TextChannel,
  guildId: string,
  track: QueueTrack,
  phase: RavePhase,
): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rave_fire_${guildId}`)
      .setLabel("🔥  keep the vibe")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rave_skull_${guildId}`)
      .setLabel("💀  switch it up")
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(PHASE_COLOR[phase])
    .setTitle(`${PHASE_LABEL[phase]}  ·  ${track.title}`)
    .setFooter({ text: `${track.author}  ·  vote closes in 25s` });

  let msg: any;
  try {
    msg = await channel.send({ embeds: [embed], components: [row] });
  } catch {
    return;
  }

  const votes  = { fire: 0, skull: 0 };
  const voters = new Set<string>();

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 25_000,
  });

  collector.on("collect", async (i: any) => {
    if (voters.has(i.user.id)) { await i.deferUpdate().catch(() => {}); return; }
    voters.add(i.user.id);
    if (i.customId.startsWith("rave_fire_"))  votes.fire++;
    if (i.customId.startsWith("rave_skull_")) votes.skull++;
    await i.deferUpdate().catch(() => {});
  });

  collector.on("end", async () => {
    const s = djSessions.get(guildId);
    if (s) s.vibeShift = votes.skull > votes.fire;

    const result =
      votes.fire === 0 && votes.skull === 0
        ? "no votes — keeping the vibe"
        : votes.skull > votes.fire
          ? `💀 ${votes.skull} vs 🔥 ${votes.fire} — switching it up next refill`
          : `🔥 ${votes.fire} vs 💀 ${votes.skull} — vibe stays`;

    await msg
      .edit({ embeds: [embed.setFooter({ text: `${track.author}  ·  ${result}` })], components: [] })
      .catch(() => {});
  });
}

// ── track start ────────────────────────────────────────────────────────────────
export function onDjTrackStart(
  guildId: string,
  track: QueueTrack,
  targetVolume: number,
  player: Player,
): void {
  cancelFades(guildId);

  const session = djSessions.get(guildId);
  if (!session) return;

  // Advance state
  session.totalTrackCount++;
  session.phase = computePhase(session.totalTrackCount - 1);
  session.lastTrackUri = track.uri;
  session.playedTracks.push({ title: track.title, author: track.author });

  if (!session.recentUris.includes(track.uri)) {
    session.recentUris.push(track.uri);
    if (session.recentUris.length > 60) session.recentUris.shift();
  }

  // Timed rave: bail out if expired
  if (session.endsAt && Date.now() > session.endsAt) {
    onDjStop(guildId);
    return;
  }

  // Crossfade in
  const targetV = targetVolume * 10;
  player.setGlobalVolume(8).catch(() => {});
  runFade(player, 8, targetV, FADE_IN_MS, guildId, false);

  // Schedule fade-out near track end
  const minDuration = FADE_IN_MS + FADE_OUT_MS + 5_000;
  if (!track.isStream && track.duration > minDuration) {
    const delay = track.duration - FADE_OUT_MS - 1_200;
    const timer = setTimeout(() => {
      fadeOutTimers.delete(guildId);
      const q = getQueue(guildId);
      if (q?.current?.encoded === track.encoded) {
        runFade(player, targetV, 0, FADE_OUT_MS, guildId, true);
      }
    }, delay);
    fadeOutTimers.set(guildId, timer);
  }

  if (!raveClient) return;
  const channel = raveClient.channels.cache.get(session.tcId) as TextChannel | null;
  if (!channel) return;

  // Vibe vote embed
  void runVibeVote(channel, guildId, track, session.phase).catch(() => {});

  // Fred commentary — 3s delay so it doesn't stack on the vote embed
  const capturedPhase = session.phase;
  const capturedGenre = session.genre;
  setTimeout(() => {
    if (!djSessions.has(guildId)) return;
    void generateRaveQuip(capturedGenre, track.title, capturedPhase).then((quip) => {
      if (!quip) return;
      const ch = raveClient?.channels.cache.get(session.tcId) as TextChannel | null;
      ch?.send({ content: quip, allowedMentions: { parse: [] } }).catch(() => {});
    });
  }, 3_000);
}

// ── stop + recap ────────────────────────────────────────────────────────────────
export function onDjStop(guildId: string): void {
  cancelFades(guildId);
  const session = djSessions.get(guildId);
  djSessions.delete(guildId);

  if (!session || !raveClient || session.playedTracks.length === 0) return;

  const channel = raveClient.channels.cache.get(session.tcId) as TextChannel | null;
  if (!channel) return;

  const durationMin = Math.round((Date.now() - session.startedAt) / 60_000);
  const list = session.playedTracks
    .slice(0, 20)
    .map((t, i) => `${i + 1}. ${t.title} — ${t.author}`)
    .join("\n");
  const overflow =
    session.playedTracks.length > 20
      ? `\n*…and ${session.playedTracks.length - 20} more*`
      : "";

  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`rave recap · ${session.genre}`)
    .setDescription(`${list}${overflow}`)
    .setFooter({ text: `${session.playedTracks.length} track${session.playedTracks.length !== 1 ? "s" : ""} · ${durationMin} min` });

  channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

// ── YouTube ID helper ────────────────────────────────────────────────────────
function extractYouTubeVideoId(uri: string): string | null {
  const m = uri.match(/[?&]v=([A-Za-z0-9_-]{8,})/);
  if (m) return m[1];
  const m2 = uri.match(/youtu\.be\/([A-Za-z0-9_-]{8,})/);
  return m2?.[1] ?? null;
}

// ── refill ─────────────────────────────────────────────────────────────────────
function buildQueryVariants(genre: string, phase: RavePhase, vibeShift: boolean): string[] {
  const base   = PHASE_SEARCH_PREFIX[phase](genre);
  const shifts = vibeShift
    ? [`${genre} deep cuts`, `${genre} underground`, `${genre} alternative`]
    : [];
  return [
    `${base} music`,
    `${base} mix`,
    `best ${base}`,
    `${base} playlist`,
    ...shifts,
  ];
}

function toQueueTrack(raw: any, requestedBy: string): QueueTrack {
  return {
    encoded:    raw.encoded,
    title:      raw.info.title,
    author:     raw.info.author,
    uri:        raw.info.uri,
    duration:   raw.info.length,
    isStream:   false,
    requestedBy,
    artworkUrl: raw.info.artworkUrl ?? null,
  };
}

export async function refillDjQueue(guildId: string, session: DjSession): Promise<void> {
  if (session.endsAt && Date.now() > session.endsAt) return;

  try {
    const node = getIdealLavalinkNode();
    if (!node) return;

    const reqBy = `rave:${session.genre}`;
    const fresh = (r: any) =>
      r?.encoded && r.info && !r.info.isStream && !session.recentUris.includes(r.info.uri);

    let tracks: QueueTrack[] = [];

    // RD-mix from last track (only when not in vibeShift mode)
    if (session.lastTrackUri && !session.vibeShift) {
      const videoId = extractYouTubeVideoId(session.lastTrackUri);
      if (videoId) {
        try {
          const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
          const result = await node.rest.resolve(mixUrl);
          if (result?.loadType === "playlist") {
            const raws: any[] = (result.data as any).tracks ?? [];
            tracks = raws.filter(fresh).slice(1, 20).map((r) => toQueueTrack(r, reqBy));
            log(`[Rave] RD-mix "${session.genre}" [${session.phase}]: ${tracks.length} fresh`, "discord");
          }
        } catch { /* fall through */ }
      }
    }

    // Fallback / supplement with genre search
    if (tracks.length < 6) {
      const variants = buildQueryVariants(session.genre, session.phase, session.vibeShift);
      const query    = variants[Math.floor(Math.random() * variants.length)];
      try {
        const result = await node.rest.resolve(`ytsearch:${query}`);
        if (result?.loadType === "search") {
          const extra = (result.data as any[]).filter(fresh).map((r) => toQueueTrack(r, reqBy));
          tracks = [...tracks, ...extra];
          log(`[Rave] search "${query}": +${extra.length} (total ${tracks.length})`, "discord");
        }
      } catch { /* ignore */ }
    }

    if (!tracks.length) {
      log(`[Rave] refill: 0 tracks for "${session.genre}" — skip`, "discord");
      return;
    }

    // Reset vibeShift now that it's been applied
    session.vibeShift = false;

    // Shuffle
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }

    await joinAndPlayMultiple(guildId, session.vcId, session.tcId, tracks);
  } catch (err: any) {
    log(`[Rave] refill error "${session.genre}": ${err.message}`, "discord");
  }
}
