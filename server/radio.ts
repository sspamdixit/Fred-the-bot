import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import {
  ActivityType,
  EmbedBuilder,
  type Guild,
  type TextChannel,
} from "discord.js";
import type { Player } from "shoukaku";
import { log } from "./index";
import {
  addListenerRequest,
  consumeNextRequest,
  generateNewsText,
  generateTrackCommentaryText,
  type TrackCommentaryContext,
} from "./radio-producer";
import {
  isLavalinkAvailable,
  radioResolveYouTube,
  radioResolveTrackOnNode,
  radioFindHttpCapableNode,
  radioJoinVoice,
  radioPlayTrackBlocking,
  radioLeaveVoiceChannel,
  type RadioYTTrack,
  type RadioTrack,
} from "./music";

const MUSIC_DIR = path.resolve("music_library");
const ASSETS_DIR = path.resolve("radio_assets");
const ASSET_KINDS = ["selftalk", "trackintro", "trackoutro", "weirdsound"] as const;
type AssetKind = typeof ASSET_KINDS[number];

const RECENT_MUSIC_LIMIT = 20;
const RECENT_YT_LIMIT = 30;
const RECENT_ASSETS_LIMIT = 15;
// Cross-session recent-track memory. Persists for the lifetime of the process
// so stopping and restarting a station doesn't replay the same opening tracks.
const GLOBAL_RECENT_YT_LIMIT = 120;
const globalRecentYTUris: string[] = [];
const STATION_NAME = "Fred FM";
const FADE_IN_MS = 1_200;
const FADE_OUT_MS = 900;
const MIN_SONGS_BETWEEN_SELFTALK = 2;
// Fred FM playlist — resolved directly on the station's pinned Lavalink node so
// the encoded track values are always from the same node that plays them.
const FRED_FM_PLAYLIST_URL = "https://open.spotify.com/playlist/0u1nVS6XR1CFjbSmkFDYyL";
const PLAYLIST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface RadioNowPlaying {
  title: string;
  artist: string;
  source: string;
  artworkUrl: string | null;
}

const stationNowPlaying = new Map<string, RadioNowPlaying>();


// Public base URL of this bot's HTTP server. Lavalink fetches the local mp3
// assets via this URL when resolving them as tracks. Required for radio to
// work — without it, only YouTube playback is possible.
function getPublicBaseUrl(): string | null {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.SERVICE_URL,
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()
      ? `https://${process.env.REPLIT_DOMAINS!.split(",")[0].trim()}`
      : undefined,
    process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined,
  ];
  for (const c of candidates) {
    if (c && c.trim()) return c.trim().replace(/\/$/, "");
  }
  return null;
}

function fileToPublicUrl(filePath: string): string | null {
  const base = getPublicBaseUrl();
  if (!base) return null;

  let prefix: string;
  let relative: string;
  if (filePath.startsWith(MUSIC_DIR + path.sep) || filePath === MUSIC_DIR) {
    prefix = "/radio-cdn/music";
    relative = path.relative(MUSIC_DIR, filePath);
  } else if (filePath.startsWith(ASSETS_DIR + path.sep) || filePath === ASSETS_DIR) {
    prefix = "/radio-cdn/assets";
    relative = path.relative(ASSETS_DIR, filePath);
  } else {
    return null;
  }
  const encoded = relative.split(path.sep).map(encodeURIComponent).join("/");
  return `${base}${prefix}/${encoded}`;
}

interface RadioStation {
  guildId: string;
  guild: Guild;
  voiceChannelId: string;
  textChannel: TextChannel;
  shardId: number;
  player: Player;
  pinnedNode: any;                      // Lavalink node hosting the player; HTTP-capable
  recentMusic: string[];               // local file paths
  recentYTUris: string[];              // youtube URIs already played this session
  playlistQueue: RadioYTTrack[];       // shuffled copy of pre-resolved playlist tracks; drained then refilled
  cachedPlaylist: RadioYTTrack[] | null; // tracks loaded from Lavalink on the pinned node
  playlistLoadedAt: number;            // epoch ms of last successful playlist load
  playlistBackoffUntil: number;        // epoch ms — skip reload attempts until this time
  recentAssets: string[];
  active: boolean;
  lastNewsHour: number;                 // UTC hour of last news segment (-1 = never)
  songsSinceSelftalk: number;          // songs played since last selftalk
  recentCommentaryTracks: Array<{ artist: string; title: string }>; // last 2 played, for commentary context
}

const stations = new Map<string, RadioStation>();

export function isRadioActive(guildId: string): boolean {
  return stations.has(guildId);
}

export function getRadioVoiceChannel(guildId: string): string | null {
  return stations.get(guildId)?.voiceChannelId ?? null;
}

async function listAudio(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(mp3|wav|ogg|opus|m4a|flac|webm)$/i.test(e.name))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function pickRandom<T>(arr: T[], exclude: Set<string> = new Set()): T | null {
  if (arr.length === 0) return null;
  const filtered = arr.filter((x) => !exclude.has(String(x)));
  const pool = filtered.length > 0 ? filtered : arr;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Proper Fisher-Yates shuffle — produces a truly uniform random permutation.
// The commonly-used .sort(() => Math.random() - 0.5) is biased because
// TimSort (V8's sort) makes fewer comparisons than needed for a uniform result,
// causing elements near the start of the input to stay near the start.
function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pushRecent(arr: string[], item: string, limit: number): void {
  arr.push(item);
  while (arr.length > limit) arr.shift();
}

function parseTrackInfo(filePath: string): { artist: string; title: string } {
  const base = path.basename(filePath, path.extname(filePath));
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: "Fred FM", title: base };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Picks an arbitrary asset URL to probe Lavalink nodes with at radio start.
// Tries the asset folders first, then falls back to a music_library file,
// then null if nothing's available.
async function pickProbeUrl(): Promise<string | null> {
  for (const k of ASSET_KINDS) {
    const files = await listAudio(path.join(ASSETS_DIR, k));
    if (files.length > 0) return fileToPublicUrl(files[0]);
  }
  const music = await listAudio(MUSIC_DIR);
  if (music.length > 0) return fileToPublicUrl(music[0]);
  return null;
}

// Lavalink track resolution + caching
// Local files don't change between rounds, so we cache resolved tracks by
// path to avoid re-hitting Lavalink (~1-3s per resolve) every transition.
// Resolution happens on the SAME node that owns the radio's player so the
// returned encoded track is guaranteed to be playable by that node.
class TrackResolver {
  private cache = new Map<string, RadioTrack>();
  constructor(private readonly node: any) {}

  async resolveFile(filePath: string): Promise<RadioTrack | null> {
    const hit = this.cache.get(filePath);
    if (hit) return hit;
    const url = fileToPublicUrl(filePath);
    if (!url) return null;
    const resolved = await radioResolveTrackOnNode(this.node, url);
    if (resolved) this.cache.set(filePath, resolved);
    return resolved;
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }
}

// YouTube-via-Lavalink playback

function cleanArtist(raw: string): string {
  return raw.replace(/\s*&.*$/, "").replace(/\s*feat\..*$/i, "").replace(/\s*ft\..*$/i, "").trim();
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s*\(.*?\)/g, "").replace(/\s*\[.*?\]/g, "").trim();
}

// Sentinel: returned when the playlist can't be loaded (caller should wait before retrying).
const PLAYLIST_UNAVAILABLE = Symbol("PLAYLIST_UNAVAILABLE");

// Loads the playlist on the station's pinned Lavalink node so the encoded track
// values come from the same node that will play them.
async function loadPlaylistOnPinnedNode(station: RadioStation): Promise<RadioYTTrack[]> {
  const now = Date.now();
  if (station.cachedPlaylist && now - station.playlistLoadedAt < PLAYLIST_CACHE_TTL) {
    return station.cachedPlaylist;
  }
  if (now < station.playlistBackoffUntil) {
    return station.cachedPlaylist ?? [];
  }
  try {
    const result = await station.pinnedNode.rest.resolve(FRED_FM_PLAYLIST_URL);
    const loadType: string = result?.loadType ?? "unknown";
    const raw: any[] = loadType === "playlist"
      ? ((result.data as any).tracks ?? [])
      : [];
    log(`[Radio] playlist resolve on pinned node: loadType=${loadType} raw=${raw.length}`, "radio");

    const tracks: RadioYTTrack[] = raw
      .filter((t: any) => t?.encoded && t.info && !t.info.isStream)
      .map((t: any) => ({
        encoded: String(t.encoded),
        title: String(t.info.title ?? "Unknown"),
        author: String(t.info.author ?? "Unknown"),
        uri: String(t.info.uri ?? ""),
        duration: Number(t.info.length) || 0,
        artworkUrl: t.info.artworkUrl ?? null,
      }));

    if (tracks.length > 0) {
      station.cachedPlaylist = tracks;
      station.playlistLoadedAt = now;
      log(`[Radio] playlist ready: ${tracks.length} playable tracks`, "radio");
      return tracks;
    }
    log(`[Radio] playlist: ${raw.length} raw, 0 playable — retry in 1 min`, "radio");
  } catch (err: any) {
    log(`[Radio] playlist load error: ${err.message}`, "radio");
  }
  station.playlistBackoffUntil = now + 60_000;
  return station.cachedPlaylist ?? [];
}

// Picks the next pre-resolved track from the playlist queue.
// Tracks are loaded on the pinned node so encoded values and player are always in sync.
async function pickYouTubeTrack(
  station: RadioStation,
): Promise<RadioYTTrack | null | typeof PLAYLIST_UNAVAILABLE> {
  const allTracks = await loadPlaylistOnPinnedNode(station);

  if (allTracks.length === 0) {
    log("[Radio] playlist unavailable — waiting for Lavalink", "radio");
    return PLAYLIST_UNAVAILABLE;
  }

  // Drain-and-refill: reshuffled each cycle so order is always different.
  if (station.playlistQueue.length === 0) {
    station.playlistQueue = shuffleArray(allTracks);
    log(`[Radio] queue refilled: ${station.playlistQueue.length} tracks (reshuffled)`, "radio");
  }

  // Skip recently-played URIs (up to 15 skips before accepting a repeat).
  const MAX_SKIP = 15;
  for (let i = 0; i < MAX_SKIP; i++) {
    if (station.playlistQueue.length === 0) {
      station.playlistQueue = shuffleArray(allTracks);
    }
    const candidate = station.playlistQueue.shift()!;
    if (
      !station.recentYTUris.includes(candidate.uri) &&
      !globalRecentYTUris.includes(candidate.uri)
    ) {
      return candidate;
    }
  }

  // All candidates were recent — just return the next one anyway.
  if (station.playlistQueue.length === 0) {
    station.playlistQueue = shuffleArray(allTracks);
  }
  return station.playlistQueue.shift() ?? null;
}

async function playYouTubeTrack(station: RadioStation, track: RadioYTTrack): Promise<void> {
  if (!station.active) return;
  pushRecent(station.recentYTUris, track.uri, RECENT_YT_LIMIT);
  pushRecent(globalRecentYTUris, track.uri, GLOBAL_RECENT_YT_LIMIT);
  setStationPresence(station, track.author);
  await sendNowPlaying(station, track.author, track.title, "YouTube via Lavalink", track.artworkUrl);
  log(`[Radio] ▶ YT ${track.author} — ${track.title}`, "radio");

  const result = await radioPlayTrackBlocking(station.player, track.encoded, track.duration);
  if (!result.ok) {
    log(`[Radio] YT playback aborted: ${result.reason}`, "radio");
  }
}

// Director / scheduling

// Break-segment picker. Called after a song (+ optional outro) to decide what
// plays before the next song. null = silence (no asset).
function pickBreakKind(
  canSelftalk: boolean,
  assetCache: Map<AssetKind, string[]>,
): AssetKind | null {
  const hasSelftalk  = canSelftalk && (assetCache.get("selftalk")  ?? []).length > 0;
  const hasWeirdsound =              (assetCache.get("weirdsound") ?? []).length > 0;
  const r = Math.random();
  if (hasSelftalk   && r < 0.40) return "selftalk";
  if (hasWeirdsound && r < 0.55) return "weirdsound";
  return null;
}

function setStationPresence(station: RadioStation, artist: string): void {
  try {
    station.guild.client.user?.setPresence({
      activities: [{ name: `${artist} on ${STATION_NAME}`, type: ActivityType.Listening }],
      status: "online",
    });
  } catch { /* ignore */ }
}

function clearStationPresence(station: RadioStation): void {
  try {
    station.guild.client.user?.setPresence({ activities: [], status: "online" });
  } catch { /* ignore */ }
}

// Smoothly ramps the player volume from `from` to `to` over `durationMs`.
// Uses 16 equal steps. Errors are swallowed — fading is best-effort.
async function fadeVolume(player: Player, from: number, to: number, durationMs: number): Promise<void> {
  const steps = 16;
  const stepMs = durationMs / steps;
  const delta = (to - from) / steps;
  for (let i = 1; i <= steps; i++) {
    await sleep(stepMs);
    const vol = Math.round(from + delta * i);
    try { await player.setGlobalVolume(Math.max(0, Math.min(100, vol))); } catch { return; }
  }
}

async function sendNowPlaying(
  station: RadioStation,
  artist: string,
  title: string,
  source: string,
  artwork: string | null = null,
): Promise<void> {
  stationNowPlaying.set(station.guildId, { title, artist, source, artworkUrl: artwork });
  try {
    const embed = new EmbedBuilder()
      .setAuthor({ name: `📻 ${STATION_NAME}` })
      .setTitle(title)
      .setDescription(`by **${artist}**`)
      .setFooter({ text: `${source} · non-stop hits and assorted noise` })
      .setColor(0xff5e3a);
    if (artwork) embed.setThumbnail(artwork);
    await station.textChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (err: any) {
    log(`[Radio] failed to post now-playing embed: ${err.message}`, "radio");
  }
}

// Plays a radio asset with smooth fade-in and fade-out, with retry on failure.
// Fade-in ramps 0→100 immediately after playback starts; fade-out begins near
// the end of the clip so the transition to the next element feels seamless.
// After the asset finishes, volume is restored to 100 for the next music track.
async function playAssetFaded(
  station: RadioStation,
  resolver: TrackResolver,
  kind: AssetKind,
  clip: string,
  pool: string[],
): Promise<void> {
  async function tryPlay(filePath: string): Promise<boolean> {
    const resolved = await resolver.resolveFile(filePath);
    if (!resolved) { resolver.invalidate(filePath); return false; }
    const dur = Math.max(resolved.duration || 0, 1_000);
    const fadeIn  = Math.min(FADE_IN_MS,  dur * 0.25);
    const fadeOut = Math.min(FADE_OUT_MS, dur * 0.25);
    const fadeOutAt = Math.max(0, dur - fadeOut - 100);
    try { await station.player.setGlobalVolume(0); } catch { /* ignore */ }
    const playPromise = radioPlayTrackBlocking(station.player, resolved.encoded, dur, 90_000);
    void fadeVolume(station.player, 0, 100, fadeIn);
    const fadeTimer = setTimeout(() => void fadeVolume(station.player, 100, 0, fadeOut), fadeOutAt);
    const result = await playPromise;
    clearTimeout(fadeTimer);
    try { await station.player.setGlobalVolume(100); } catch { /* ignore */ }
    if (!result.ok) {
      log(`[Radio] · ${kind}: playback failed for ${path.basename(filePath)} (${result.reason})`, "radio");
      resolver.invalidate(filePath);
      return false;
    }
    return true;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (await tryPlay(clip)) return;
    if (!station.active) return;
  }

  const alternates = pool.filter((p) => p !== clip);
  if (alternates.length === 0) {
    log(`[Radio] · ${kind}: no alternates to fall back to — slot dropped`, "radio");
    return;
  }
  const alt = alternates[Math.floor(Math.random() * alternates.length)];
  log(`[Radio] · ${kind}: falling back to ${path.basename(alt)}`, "radio");
  await tryPlay(alt);
}

async function playLocalMusic(station: RadioStation, resolver: TrackResolver, musicFiles: string[]): Promise<void> {
  const trackPath = pickRandom(musicFiles, new Set(station.recentMusic))!;
  pushRecent(station.recentMusic, trackPath, RECENT_MUSIC_LIMIT);
  const { artist, title } = parseTrackInfo(trackPath);

  const resolved = await resolver.resolveFile(trackPath);
  if (!resolved) {
    log(`[Radio] failed to resolve local file ${path.basename(trackPath)} — skipping`, "radio");
    return;
  }

  setStationPresence(station, artist);
  await sendNowPlaying(station, artist, title, "Local Library");
  log(`[Radio] ▶ LOCAL ${artist} — ${title}`, "radio");

  const result = await radioPlayTrackBlocking(station.player, resolved.encoded, resolved.duration);
  if (!result.ok) {
    log(`[Radio] LOCAL playback aborted: ${result.reason}`, "radio");
  }
  // Only track in commentary history when playback actually succeeded.
  if (result.ok) {
    station.recentCommentaryTracks.push({ artist, title });
    if (station.recentCommentaryTracks.length > 2) station.recentCommentaryTracks.shift();
  }
}

async function broadcastLoop(station: RadioStation): Promise<void> {
  const playlistSize = station.cachedPlaylist?.length ?? 0;
  log(
    `[Radio] director config: lavalink=${isLavalinkAvailable()} playlist=${playlistSize > 0 ? `${playlistSize} tracks` : "loading..."}`,
    "radio",
  );

  const resolver = new TrackResolver(station.pinnedNode);

  while (station.active) {
    // Re-evaluate sources every loop so a Lavalink node coming online (or
    // going offline) mid-broadcast is picked up without restarting the radio.
    const ytAvailable = isLavalinkAvailable();
    const assetCache = new Map<AssetKind, string[]>();
    for (const k of ASSET_KINDS) {
      assetCache.set(k, await listAudio(path.join(ASSETS_DIR, k)));
    }

    if (!ytAvailable) {
      try {
        await station.textChannel.send({
          content: "lavalink is offline. broadcast paused — will resume when it comes back.",
          allowedMentions: { parse: [] },
        });
      } catch { /* ignore */ }
      await sleep(30_000);
      continue;
    }

    // Top-of-hour: post a news bulletin as a text message (no audio — Lukas stays on air).
    const currentHour = new Date().getUTCHours();
    if (station.lastNewsHour !== currentHour) {
      station.lastNewsHour = currentHour;
      log(`[Radio] · top-of-hour news (text only, hour=${currentHour})`, "radio");
      void (async () => {
        try {
          const newsText = await generateNewsText();
          if (newsText && station.active) {
            await station.textChannel.send({
              content: newsText,
              allowedMentions: { parse: [] },
            });
          }
        } catch (err: any) {
          log(`[Radio] · news text error: ${err.message}`, "radio");
        }
      })();
    }

    // Check for listener requests — play next request if available.
    const request = consumeNextRequest(station.guildId);

    if (request) {
      // Listener request: text announcement to channel, then play via YouTube.
      // Audio is ALWAYS Lukas assets — no generated TTS voice.
      log(`[Radio] · listener request from ${request.requesterName}: ${request.query}`, "radio");
      try {
        const tracks = await radioResolveYouTube(request.query, 5);
        const track = tracks[0] ?? null;
        if (track) {
          // Text-only announcement — keeping Lukas as the only voice on air.
          try {
            await station.textChannel.send({
              content: `📻 **request from ${request.requesterName}:** playing **${track.title}** by **${track.author}**`,
              allowedMentions: { parse: [] },
            });
          } catch { /* non-critical */ }
          if (station.active) {
            await playYouTubeTrack(station, track);
            // Track in commentary history for subsequent commentary context.
            station.recentCommentaryTracks.push({ artist: track.author, title: track.title });
            if (station.recentCommentaryTracks.length > 2) station.recentCommentaryTracks.shift();
          }
        } else {
          log(`[Radio] · request "${request.query}" resolved nothing — skipping`, "radio");
          try {
            await station.textChannel.send({
              content: `📻 couldn't find anything for **${request.requesterName}**'s request ("${request.query}"). moving on.`,
              allowedMentions: { parse: [] },
            });
          } catch { /* non-critical */ }
        }
      } catch (err: any) {
        log(`[Radio] · listener request error: ${err.message}`, "radio");
      }
    } else {
      // Always pull from the Spotify playlist — no seeds, no discovery, no fallback sources.
      const track = await pickYouTubeTrack(station);
      if (track === PLAYLIST_UNAVAILABLE) {
        // Lavalink unavailable or playlist unresolvable — back off before retrying.
        await sleep(15_000);
        continue;
      } else if (!track) {
        // Exhausted the skip limit (very unusual). Brief pause then try again.
        await sleep(2_000);
        continue;
      } else {
        // Post Fred's text commentary about the track (non-blocking, non-audio).
        // Capture commentary context snapshot before firing so the async closure
        // sees the right values even if the outer vars mutate during playback.
        const _commentaryCtx: TrackCommentaryContext = {
          prevTracks: [...station.recentCommentaryTracks],
          afterAdvert: false,
        };
        void (async () => {
          try {
            const comment = await generateTrackCommentaryText(track.author, track.title, _commentaryCtx);
            if (comment && station.active) {
              await station.textChannel.send({
                content: `📻 ${comment}`,
                allowedMentions: { parse: [] },
              });
            }
          } catch { /* non-critical */ }
        })();
        await playYouTubeTrack(station, track);
        // Push to history AFTER the track plays so the next commentary sees it.
        station.recentCommentaryTracks.push({ artist: track.author, title: track.title });
        if (station.recentCommentaryTracks.length > 2) station.recentCommentaryTracks.shift();
      }
    }
    if (!station.active) return;

    // Update per-song pacing counter.
    station.songsSinceSelftalk++;

    // Director: asset segment — ALWAYS from radio_assets/, no exceptions.
    // Lukas is the only voice on Fred FM. No generated TTS, ever.
    //
    // Flow per song:
    //   [trackoutro]  → Lukas signs off the track just finished (50% chance)
    //   [break]       → selftalk / weirdsound / silence (no adverts)
    //   [trackintro]  → Lukas introduces the next song (50% chance after selftalk)

    // 1. Post-song outro.
    const outros = assetCache.get("trackoutro") ?? [];
    if (outros.length > 0 && Math.random() < 0.50) {
      const outro = pickRandom(outros, new Set(station.recentAssets))!;
      pushRecent(station.recentAssets, outro, RECENT_ASSETS_LIMIT);
      log(`[Radio] · trackoutro: ${path.basename(outro)}`, "radio");
      await playAssetFaded(station, resolver, "trackoutro", outro, outros);
      if (!station.active) return;
    }

    // 2. Break segment.
    const canSelftalk = station.songsSinceSelftalk >= MIN_SONGS_BETWEEN_SELFTALK;
    const breakKind   = pickBreakKind(canSelftalk, assetCache);

    if (breakKind !== null) {
      const breakPool = assetCache.get(breakKind) ?? [];
      if (breakPool.length > 0) {
        const clip = pickRandom(breakPool, new Set(station.recentAssets))!;
        pushRecent(station.recentAssets, clip, RECENT_ASSETS_LIMIT);
        log(`[Radio] · ${breakKind}: ${path.basename(clip)}`, "radio");
        await playAssetFaded(station, resolver, breakKind, clip, breakPool);
        if (!station.active) return;
        if (breakKind === "selftalk") {
          station.songsSinceSelftalk = 0;
          // 50% chance Lukas introduces the next track after selftalk.
          const intros = assetCache.get("trackintro") ?? [];
          if (intros.length > 0 && Math.random() < 0.50) {
            const intro = pickRandom(intros, new Set(station.recentAssets))!;
            pushRecent(station.recentAssets, intro, RECENT_ASSETS_LIMIT);
            log(`[Radio] · trackintro: ${path.basename(intro)}`, "radio");
            await playAssetFaded(station, resolver, "trackintro", intro, intros);
            if (!station.active) return;
          }
        }
      } else {
        log(`[Radio] · ${breakKind} pool empty — silence`, "radio");
      }
    } else {
      log(`[Radio] · silence`, "radio");
    }
  }
}

// public lifecycle

export async function startRadio(
  guild: Guild,
  voiceChannelId: string,
  textChannel: TextChannel,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (stations.has(guild.id)) {
    return { ok: false, reason: `${STATION_NAME} is already on the air in this server. use \`/radiostop\` first.` };
  }
  if (!existsSync(ASSETS_DIR)) {
    return { ok: false, reason: "`radio_assets/` folder is missing. cannot broadcast." };
  }

  if (!isLavalinkAvailable()) {
    return {
      ok: false,
      reason: "lavalink isn't connected. radio needs at least one healthy lavalink node — try again in a minute.",
    };
  }

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      reason:
        "no public base URL configured. set one of `PUBLIC_BASE_URL`, `RENDER_EXTERNAL_URL`, or `SERVICE_URL` so lavalink can fetch the radio assets over HTTP.",
    };
  }

  const localFiles = await listAudio(MUSIC_DIR);
  log(`[Radio] starting · base=${baseUrl} · local-files=${localFiles.length}`, "radio");

  // Probe Lavalink nodes for HTTP source support — required for radio assets.
  // We pin the radio player to whichever node passes so resolution AND
  // playback are guaranteed to work for every asset clip in the rotation.
  const probeUrl = await pickProbeUrl();
  if (!probeUrl) {
    return {
      ok: false,
      reason: "no radio assets found to probe with — drop some files into `radio_assets/` first.",
    };
  }

  const httpNode = await radioFindHttpCapableNode(probeUrl);
  if (!httpNode) {
    return {
      ok: false,
      reason:
        "none of the connected lavalink nodes accept HTTP-source URLs, so the radio can't play the assets. either provide a node with the HTTP source manager enabled (`LAVALINK_NODES`) or use a self-hosted lavalink with `sources.http: true`.",
    };
  }

  log(`[Radio] pinned to lavalink node '${httpNode.name}' (HTTP source verified)`, "radio");

  const joinResult = await radioJoinVoice(guild.id, voiceChannelId, guild.shardId ?? 0, httpNode);
  if (!joinResult.ok) {
    return { ok: false, reason: `couldn't join voice via lavalink: ${joinResult.reason}` };
  }

  const station: RadioStation = {
    guildId: guild.id,
    guild,
    voiceChannelId,
    textChannel,
    shardId: guild.shardId ?? 0,
    player: joinResult.player,
    pinnedNode: httpNode,
    recentMusic: [],
    recentYTUris: [],
    playlistQueue: [],
    cachedPlaylist: null,
    playlistLoadedAt: 0,
    playlistBackoffUntil: 0,
    recentAssets: [],
    active: true,
    lastNewsHour: -1,
    songsSinceSelftalk: MIN_SONGS_BETWEEN_SELFTALK,
    recentCommentaryTracks: [],
  };
  stations.set(guild.id, station);

  log(`[Radio] ON AIR in ${guild.name} (vc ${voiceChannelId}) · local=${localFiles.length}`, "radio");

  // Pre-warm the playlist cache on the pinned node so the first pick is instant.
  void loadPlaylistOnPinnedNode(station).catch(() => {});

  void broadcastLoop(station).catch((err) => {
    log(`[Radio] broadcast loop crashed: ${err?.message ?? err}`, "radio");
    stopStation(guild.id, "loop error");
  });

  return { ok: true };
}

export function stopRadio(guildId: string): boolean {
  return stopStation(guildId, "stop command");
}

function stopStation(guildId: string, reason: string): boolean {
  const station = stations.get(guildId);
  if (!station) return false;
  station.active = false;
  stations.delete(guildId);
  stationNowPlaying.delete(guildId);
  void radioLeaveVoiceChannel(guildId);
  clearStationPresence(station);
  log(`[Radio] OFF AIR in guild ${guildId} (${reason})`, "radio");
  return true;
}

export function getRadioNowPlaying(guildId: string): RadioNowPlaying | null {
  return stationNowPlaying.get(guildId) ?? null;
}

export interface RadioStationStatus {
  guildId: string;
  guildName: string;
  voiceChannelId: string;
  nowPlaying: RadioNowPlaying | null;
  songsSinceSelftalk: number;
}

export function getRadioAllStationsStatus(): RadioStationStatus[] {
  return Array.from(stations.values()).map((s) => ({
    guildId: s.guildId,
    guildName: s.guild.name,
    voiceChannelId: s.voiceChannelId,
    nowPlaying: stationNowPlaying.get(s.guildId) ?? null,
    songsSinceSelftalk: s.songsSinceSelftalk,
  }));
}

export function getPlaylistSource(): "spotify" {
  return "spotify";
}

export function getCachedPlaylistTrackCount(): number {
  for (const s of stations.values()) {
    if (s.cachedPlaylist) return s.cachedPlaylist.length;
  }
  return 0;
}

export async function pauseRadio(guildId: string): Promise<boolean> {
  const station = stations.get(guildId);
  if (!station) return false;
  await station.player.setPaused(true);
  return true;
}

export async function resumeRadio(guildId: string): Promise<boolean> {
  const station = stations.get(guildId);
  if (!station) return false;
  await station.player.setPaused(false);
  return true;
}

export async function setRadioVolume(guildId: string, vol: number): Promise<boolean> {
  const station = stations.get(guildId);
  if (!station) return false;
  await station.player.setGlobalVolume(vol);
  return true;
}

export function radioSkipCurrentTrack(guildId: string): boolean {
  const station = stations.get(guildId);
  if (!station) return false;
  station.player.stopTrack();
  return true;
}

// Re-export listener request API for bot.ts to use.
export function addRadioRequest(guildId: string, requesterName: string, query: string): boolean {
  return addListenerRequest(guildId, requesterName, query);
}

export async function previewLibrary(): Promise<{
  music: number;
  assets: Record<AssetKind, number>;
  youtube: boolean;
  publicBaseUrl: string | null;
}> {
  const music = (await listAudio(MUSIC_DIR)).length;
  const assets = {} as Record<AssetKind, number>;
  for (const k of ASSET_KINDS) {
    assets[k] = (await listAudio(path.join(ASSETS_DIR, k))).length;
  }
  return {
    music,
    assets,
    youtube: isLavalinkAvailable(),
    publicBaseUrl: getPublicBaseUrl(),
  };
}
