import { log } from "./index";
import { joinAndPlayMultiple, getQueue, getIdealLavalinkNode, type QueueTrack } from "./music";
import type { Player } from "shoukaku";

const FADE_IN_MS  = 1_400;
const FADE_OUT_MS = 2_000;
const FADE_STEPS  = 28;

export interface DjSession {
  genre: string;
  vcId: string;
  tcId: string;
  lastTrackUri: string | null;
  recentUris: string[];
}

export const djSessions = new Map<string, DjSession>();

// Per-guild timers for scheduled fade-outs and in-progress fade intervals
const fadeOutTimers   = new Map<string, ReturnType<typeof setTimeout>>();
const fadeIntervals   = new Map<string, ReturnType<typeof setInterval>>();

export function getDjStatus(): Array<{ guildId: string; genre: string }> {
  return [...djSessions.entries()].map(([guildId, s]) => ({ guildId, genre: s.genre }));
}

function extractYouTubeVideoId(uri: string): string | null {
  const m = uri.match(/[?&]v=([A-Za-z0-9_-]{8,})/);
  if (m) return m[1];
  const m2 = uri.match(/youtu\.be\/([A-Za-z0-9_-]{8,})/);
  return m2?.[1] ?? null;
}

function cancelFades(guildId: string): void {
  const t = fadeOutTimers.get(guildId);
  if (t) { clearTimeout(t); fadeOutTimers.delete(guildId); }
  const iv = fadeIntervals.get(guildId);
  if (iv) { clearInterval(iv); fadeIntervals.delete(guildId); }
}

function runFade(
  player: Player,
  fromVol: number,
  toVol: number,
  durationMs: number,
  guildId: string,
  trackFadeInterval: boolean,
): void {
  const stepMs = Math.max(20, Math.floor(durationMs / FADE_STEPS));
  const delta   = (toVol - fromVol) / FADE_STEPS;
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

export function onDjTrackStart(
  guildId: string,
  track: QueueTrack,
  targetVolume: number,
  player: Player,
): void {
  cancelFades(guildId);

  const session = djSessions.get(guildId);
  if (!session) return;

  // Keep a rolling window of recent URIs to avoid replaying the same songs
  session.lastTrackUri = track.uri;
  if (!session.recentUris.includes(track.uri)) {
    session.recentUris.push(track.uri);
    if (session.recentUris.length > 60) session.recentUris.shift();
  }

  const targetV = targetVolume * 10; // queue.volume is 0-100, setGlobalVolume is 0-1000

  // ── Fade in ──────────────────────────────────────────────────────────────
  player.setGlobalVolume(8).catch(() => {});
  runFade(player, 8, targetV, FADE_IN_MS, guildId, false);

  // ── Schedule fade-out near end ────────────────────────────────────────────
  const minDuration = FADE_IN_MS + FADE_OUT_MS + 5_000;
  if (!track.isStream && track.duration > minDuration) {
    const delay = track.duration - FADE_OUT_MS - 1_200;
    const timer = setTimeout(() => {
      fadeOutTimers.delete(guildId);
      // Verify we're still on the same track before fading
      const q = getQueue(guildId);
      if (q?.current?.encoded === track.encoded) {
        runFade(player, targetV, 0, FADE_OUT_MS, guildId, true);
      }
    }, delay);
    fadeOutTimers.set(guildId, timer);
  }
}

export function onDjStop(guildId: string): void {
  cancelFades(guildId);
  djSessions.delete(guildId);
}

// ── Smart queue refill ────────────────────────────────────────────────────

const GENRE_QUERY_VARIANTS = (genre: string): string[] => [
  `${genre} music`,
  `${genre} hits`,
  `${genre} mix`,
  `best ${genre} songs`,
  `${genre} vibes playlist`,
  `top ${genre}`,
];

function toQueueTrack(raw: any, requestedBy: string): QueueTrack {
  return {
    encoded:     raw.encoded,
    title:       raw.info.title,
    author:      raw.info.author,
    uri:         raw.info.uri,
    duration:    raw.info.length,
    isStream:    false,
    requestedBy,
    artworkUrl:  raw.info.artworkUrl ?? null,
  };
}

export async function refillDjQueue(guildId: string, session: DjSession): Promise<void> {
  try {
    const node = getIdealLavalinkNode();
    if (!node) return;

    const reqBy = `dj:${session.genre}`;
    const fresh = (r: any) => r?.encoded && r.info && !r.info.isStream && !session.recentUris.includes(r.info.uri);
    let tracks: QueueTrack[] = [];

    // ── Strategy 1: YouTube radio-mix from last played track ─────────────────
    // YouTube's RD playlist groups tracks by energy, tempo, and mood —
    // the closest proxy to BPM matching without audio analysis.
    if (session.lastTrackUri) {
      const videoId = extractYouTubeVideoId(session.lastTrackUri);
      if (videoId) {
        try {
          const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
          const result = await node.rest.resolve(mixUrl);
          if (result?.loadType === "playlist") {
            const raws: any[] = (result.data as any).tracks ?? [];
            tracks = raws
              .filter(fresh)
              .slice(1, 20) // skip first — it's the seed track itself
              .map((r) => toQueueTrack(r, reqBy));
            log(`[DJ] RD-mix for "${session.genre}": ${tracks.length} fresh tracks`, "discord");
          }
        } catch { /* fall through to genre search */ }
      }
    }

    // ── Strategy 2: Genre search top-up (or sole source if no seed yet) ──────
    if (tracks.length < 6) {
      const variants = GENRE_QUERY_VARIANTS(session.genre);
      const query = variants[Math.floor(Math.random() * variants.length)];
      try {
        const result = await node.rest.resolve(`ytsearch:${query}`);
        if (result?.loadType === "search") {
          const raws = (result.data as any[]).filter(fresh);
          const extra = raws.map((r) => toQueueTrack(r, reqBy));
          tracks = [...tracks, ...extra];
          log(`[DJ] genre-search "${query}": +${extra.length} tracks (total ${tracks.length})`, "discord");
        }
      } catch { /* ignore */ }
    }

    if (!tracks.length) {
      log(`[DJ] refill: 0 tracks found for "${session.genre}" — skipping`, "discord");
      return;
    }

    // Light shuffle so playback order is never identical across refills
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }

    await joinAndPlayMultiple(guildId, session.vcId, session.tcId, tracks);
  } catch (err: any) {
    log(`[DJ] refill error for "${session.genre}": ${err.message}`, "discord");
  }
}
