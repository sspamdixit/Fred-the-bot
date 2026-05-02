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
import { getMoodSeeds } from "./mood-engine";
import {
  addListenerRequest,
  consumeNextRequest,
  generateNewsText,
  generateTrackCommentaryText,
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
const ASSET_KINDS = ["advert", "selftalk", "trackintro", "trackoutro", "weirdsound"] as const;
type AssetKind = typeof ASSET_KINDS[number];

const RECENT_MUSIC_LIMIT = 20;
const RECENT_YT_LIMIT = 30;
const RECENT_ASSETS_LIMIT = 15;
const STATION_NAME = "Fred FM";
const FRED_FM_PLAYLIST_ID = (process.env.FRED_FM_PLAYLIST ?? "0u1nVS6XR1CFjbSmkFDYyL").trim();
const FRED_FM_YT_PLAYLIST = process.env.FRED_FM_YT_PLAYLIST?.trim() ?? null;
const PLAYLIST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface PlaylistTrack { title: string; artist: string; }
let cachedPlaylistTracks: PlaylistTrack[] | null = null;
let playlistCacheTime = 0;

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchPlaylistTracks(): Promise<PlaylistTrack[]> {
  const now = Date.now();
  if (cachedPlaylistTracks && now - playlistCacheTime < PLAYLIST_CACHE_TTL) {
    return cachedPlaylistTracks;
  }

  // --- Spotify path ---
  const token = await getSpotifyToken();
  if (token) {
    const tracks: PlaylistTrack[] = [];
    let url: string | null = `https://api.spotify.com/v1/playlists/${FRED_FM_PLAYLIST_ID}/tracks?limit=100&fields=next,items(track(name,artists(name)))`;
    while (url) {
      try {
        const res = await fetch(url, {
          headers: { "Authorization": `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) break;
        const data = await res.json() as {
          next: string | null;
          items: Array<{ track: { name: string; artists: Array<{ name: string }> } | null }>;
        };
        for (const item of data.items) {
          if (!item.track) continue;
          tracks.push({ artist: item.track.artists[0]?.name ?? "Unknown", title: item.track.name });
        }
        url = data.next ?? null;
      } catch {
        break;
      }
    }
    if (tracks.length > 0) {
      cachedPlaylistTracks = tracks;
      playlistCacheTime = now;
      log(`[Radio] Spotify playlist loaded: ${tracks.length} tracks from ${FRED_FM_PLAYLIST_ID}`, "radio");
      return tracks;
    }
    log(`[Radio] Spotify playlist fetch returned 0 tracks`, "radio");
  }

  // --- YouTube playlist path (no Spotify creds needed) ---
  if (FRED_FM_YT_PLAYLIST) {
    try {
      log(`[Radio] Loading YouTube playlist: ${FRED_FM_YT_PLAYLIST}`, "radio");
      const ytTracks = await radioResolveYouTube(FRED_FM_YT_PLAYLIST, 500);
      if (ytTracks.length > 0) {
        const tracks: PlaylistTrack[] = ytTracks.map((t) => ({
          artist: t.author,
          title: t.title,
        }));
        cachedPlaylistTracks = tracks;
        playlistCacheTime = now;
        log(`[Radio] YouTube playlist loaded: ${tracks.length} tracks`, "radio");
        return tracks;
      }
      log(`[Radio] YouTube playlist resolved 0 tracks — using genre seeds`, "radio");
    } catch (err: any) {
      log(`[Radio] YouTube playlist load error: ${err.message} — using genre seeds`, "radio");
    }
  }

  if (!token && !FRED_FM_YT_PLAYLIST) {
    log("[Radio] No playlist configured (SPOTIFY_CLIENT_ID/SECRET or FRED_FM_YT_PLAYLIST) — using genre seeds", "radio");
  }
  return [];
}

export interface RadioNowPlaying {
  title: string;
  artist: string;
  source: string;
  artworkUrl: string | null;
}

const stationNowPlaying = new Map<string, RadioNowPlaying>();

// Default search seeds for the YouTube-via-Lavalink rotation. Override with
// the `RADIO_YT_SEEDS` env var (comma-separated). Each round picks one and
// queries Lavalink for matches.
const DEFAULT_YT_SEEDS = [
  "lo-fi hip hop", "indie rock 2024", "synthwave", "classic rock hits",
  "80s pop", "90s alternative", "house music", "drum and bass",
  "j-pop hits", "k-pop hits", "afrobeats", "reggae classics",
  "jazz standards", "ambient electronic", "shoegaze", "post-punk",
  "soul classics", "funk grooves", "blues guitar", "folk acoustic",
  "metal anthems", "punk rock", "trip hop", "dream pop",
  "italo disco", "city pop japan", "trap beats", "hyperpop",
];

function getYTSeeds(): string[] {
  const raw = process.env.RADIO_YT_SEEDS?.trim();
  if (!raw) return DEFAULT_YT_SEEDS;
  const seeds = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return seeds.length > 0 ? seeds : DEFAULT_YT_SEEDS;
}

function getYouTubeMixRatio(): number {
  // Probability that a music slot pulls from YouTube (0..1). Default 0.5.
  const raw = process.env.RADIO_YT_RATIO;
  if (!raw) return 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

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
  recentYTUris: string[];              // youtube URIs already played
  recentAssets: string[];
  active: boolean;
  lastNewsHour: number;                 // UTC hour of last news segment (-1 = never)
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

async function pickYouTubeTrack(station: RadioStation): Promise<RadioYTTrack | null> {
  const playlistTracks = await fetchPlaylistTracks();

  let seedsToTry: string[];

  if (playlistTracks.length > 0) {
    const r = Math.random();

    if (r < 0.50) {
      // 50%: play a specific track from the Spotify playlist.
      // Shuffle and sample so every track in a large playlist gets rotation.
      const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
      seedsToTry = shuffled.slice(0, 20).map((t) => `${t.artist} ${t.title}`);

    } else if (r < 0.80) {
      // 30%: artist-level discovery — radiate outward from a playlist artist.
      const base = playlistTracks[Math.floor(Math.random() * playlistTracks.length)];
      const artist = cleanArtist(base.artist);
      seedsToTry = [
        `${artist} radio mix`,
        `${artist} similar artists mix`,
        `best of ${artist}`,
        `${artist} top songs`,
        `songs like ${artist}`,
        `${artist} type music`,
        `music similar to ${artist}`,
        `fans of ${artist} playlist`,
        `${artist} deep cuts`,
        `${artist} b-sides`,
      ];

    } else if (r < 0.95) {
      // 15%: track-level discovery — radiate outward from a specific playlist song.
      const base = playlistTracks[Math.floor(Math.random() * playlistTracks.length)];
      const artist = cleanArtist(base.artist);
      const title = cleanTitle(base.title);
      seedsToTry = [
        `songs like ${artist} ${title}`,
        `music like ${title} ${artist}`,
        `${artist} ${title} similar`,
        `if you like ${title} by ${artist}`,
        `${title} ${artist} type songs`,
        `${artist} discography mix`,
      ];

    } else {
      // 5%: cross-playlist discovery — find music at the intersection of two
      // random playlist artists so the radio develops a coherent blend.
      const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
      const artistA = cleanArtist(shuffled[0]?.artist ?? "");
      const artistB = cleanArtist(shuffled[1]?.artist ?? "");
      if (artistA && artistB && artistA !== artistB) {
        seedsToTry = [
          `${artistA} ${artistB} mix`,
          `fans of ${artistA} and ${artistB}`,
          `${artistA} meets ${artistB} playlist`,
          `${artistA} x ${artistB}`,
        ];
      } else {
        // Not enough distinct artists — fall back to direct playlist track
        seedsToTry = shuffled.slice(0, 20).map((t) => `${t.artist} ${t.title}`);
      }
    }

  } else {
    // No Spotify credentials or fetch failed — mood-aware seeds keep the
    // broadcast alive without any Spotify dependency.
    const moodSeeds = (() => {
      try {
        return getMoodSeeds(station.guildId, station.textChannel.id);
      } catch {
        return null;
      }
    })();
    seedsToTry = moodSeeds ?? getYTSeeds();
  }

  // Try up to 5 different seeds before giving up.
  for (let i = 0; i < 5; i++) {
    const seed = seedsToTry[Math.floor(Math.random() * seedsToTry.length)];
    const tracks = await radioResolveYouTube(seed, 12);
    if (!tracks.length) continue;
    const fresh = tracks.filter((t) => !station.recentYTUris.includes(t.uri));
    const pool = fresh.length > 0 ? fresh : tracks;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) return pick;
  }
  return null;
}

async function playYouTubeTrack(station: RadioStation, track: RadioYTTrack): Promise<void> {
  if (!station.active) return;
  pushRecent(station.recentYTUris, track.uri, RECENT_YT_LIMIT);
  setStationPresence(station, track.author);
  await sendNowPlaying(station, track.author, track.title, "YouTube via Lavalink", track.artworkUrl);
  log(`[Radio] ▶ YT ${track.author} — ${track.title}`, "radio");

  const result = await radioPlayTrackBlocking(station.player, track.encoded, track.duration);
  if (!result.ok) {
    log(`[Radio] YT playback aborted: ${result.reason}`, "radio");
  }
}

// Director / scheduling

function pickDirectorKind(): AssetKind | "silence" {
  const r = Math.random();
  // 40% silence, 30% trackoutro, 15% advert, 10% selftalk, 5% weirdsound
  if (r < 0.40) return "silence";
  if (r < 0.70) return "trackoutro";
  if (r < 0.85) return "advert";
  if (r < 0.95) return "selftalk";
  return "weirdsound";
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

// Plays a radio asset (advert/intro/outro/etc) with retry. Assets are short
// — silently dropping one defeats the point of the radio. We retry up to
// twice with a fresh resolve in case the cached encoded blob expired or the
// node hiccuped, and on the second failure we try a different clip from the
// same kind so the slot is never empty.
async function playAsset(
  station: RadioStation,
  resolver: TrackResolver,
  kind: AssetKind,
  clip: string,
  pool: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const resolved = await resolver.resolveFile(clip);
    if (!resolved) {
      log(`[Radio] · ${kind}: resolve failed for ${path.basename(clip)} (attempt ${attempt + 1})`, "radio");
      resolver.invalidate(clip);
      continue;
    }
    const result = await radioPlayTrackBlocking(
      station.player,
      resolved.encoded,
      resolved.duration,
      90_000,
    );
    if (result.ok) return;
    log(`[Radio] · ${kind}: playback failed for ${path.basename(clip)} (${result.reason}, attempt ${attempt + 1})`, "radio");
    // Encoded blob might be stale — drop the cache so we re-resolve.
    resolver.invalidate(clip);
    if (!station.active) return;
  }

  // Fallback: try a different clip from the same kind.
  const alternates = pool.filter((p) => p !== clip);
  if (alternates.length === 0) {
    log(`[Radio] · ${kind}: no alternates to fall back to — slot dropped`, "radio");
    return;
  }
  const alt = alternates[Math.floor(Math.random() * alternates.length)];
  log(`[Radio] · ${kind}: falling back to ${path.basename(alt)}`, "radio");
  const altResolved = await resolver.resolveFile(alt);
  if (!altResolved) {
    log(`[Radio] · ${kind}: fallback resolve also failed — slot dropped`, "radio");
    return;
  }
  const altResult = await radioPlayTrackBlocking(
    station.player,
    altResolved.encoded,
    altResolved.duration,
    90_000,
  );
  if (!altResult.ok) {
    log(`[Radio] · ${kind}: fallback playback failed (${altResult.reason}) — slot dropped`, "radio");
  }
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
}

async function broadcastLoop(station: RadioStation): Promise<void> {
  const ytRatio = getYouTubeMixRatio();
  const playlistSize = cachedPlaylistTracks?.length ?? 0;
  log(
    `[Radio] director config: yt-available=${isLavalinkAvailable()} yt-ratio=${ytRatio.toFixed(2)} playlist=${playlistSize > 0 ? `${playlistSize} tracks` : FRED_FM_YT_PLAYLIST ? "yt-playlist (loading...)" : "genre seeds (no playlist configured)"}`,
    "radio",
  );

  const resolver = new TrackResolver(station.pinnedNode);

  while (station.active) {
    // Re-evaluate sources every loop so a Lavalink node coming online (or
    // going offline) mid-broadcast is picked up without restarting the radio.
    const ytAvailable = isLavalinkAvailable();
    const musicFiles = await listAudio(MUSIC_DIR);
    const assetCache = new Map<AssetKind, string[]>();
    for (const k of ASSET_KINDS) {
      assetCache.set(k, await listAudio(path.join(ASSETS_DIR, k)));
    }

    if (!ytAvailable && musicFiles.length === 0) {
      try {
        await station.textChannel.send({
          content: "lavalink is offline and there are no local music files. broadcast over.",
          allowedMentions: { parse: [] },
        });
      } catch { /* ignore */ }
      stopStation(station.guildId, "no music sources");
      return;
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

    // Pick this slot's music source.
    let pickYT: boolean;
    if (musicFiles.length === 0) pickYT = true;
    else if (!ytAvailable) pickYT = false;
    else pickYT = Math.random() < ytRatio;

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
    } else if (pickYT) {
      const track = await pickYouTubeTrack(station);
      if (!track) {
        log(`[Radio] YT pick failed — falling back to local file`, "radio");
        if (musicFiles.length > 0) {
          await playLocalMusic(station, resolver, musicFiles);
        } else {
          await sleep(5_000);
          continue;
        }
      } else {
        // Post Fred's text commentary about the track (non-blocking, non-audio).
        void (async () => {
          try {
            const comment = await generateTrackCommentaryText(track.author, track.title);
            if (comment && station.active) {
              await station.textChannel.send({
                content: `📻 ${comment}`,
                allowedMentions: { parse: [] },
              });
            }
          } catch { /* non-critical */ }
        })();
        await playYouTubeTrack(station, track);
      }
    } else {
      await playLocalMusic(station, resolver, musicFiles);
    }
    if (!station.active) return;

    // Director: in-between asset segment — ALWAYS from radio_assets/, no exceptions.
    // Lukas is the only voice on Fred FM. No generated TTS, ever.

    const kind = pickDirectorKind();
    if (kind === "silence") {
      log(`[Radio] · silence`, "radio");
      continue;
    }

    const pool = assetCache.get(kind) ?? [];
    if (pool.length === 0) {
      log(`[Radio] · ${kind} pool empty — silence instead`, "radio");
      continue;
    }

    const clip = pickRandom(pool, new Set(station.recentAssets))!;
    pushRecent(station.recentAssets, clip, RECENT_ASSETS_LIMIT);
    log(`[Radio] · ${kind}: ${path.basename(clip)}`, "radio");
    await playAsset(station, resolver, kind, clip, pool);
    if (!station.active) return;

    // 25% chance trackintro after a trackoutro — asset files only.
    if (kind === "trackoutro" && Math.random() < 0.25) {
      const intros = assetCache.get("trackintro") ?? [];
      if (intros.length > 0) {
        const intro = pickRandom(intros, new Set(station.recentAssets))!;
        pushRecent(station.recentAssets, intro, RECENT_ASSETS_LIMIT);
        log(`[Radio] · DJ transition (trackintro): ${path.basename(intro)}`, "radio");
        await playAsset(station, resolver, "trackintro", intro, intros);
        if (!station.active) return;
      }
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
    recentAssets: [],
    active: true,
    lastNewsHour: -1,
  };
  stations.set(guild.id, station);

  log(`[Radio] ON AIR in ${guild.name} (vc ${voiceChannelId}) · local=${localFiles.length}`, "radio");

  // Pre-warm the Spotify playlist cache so the first track pick is instant.
  void fetchPlaylistTracks().catch(() => {});

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
