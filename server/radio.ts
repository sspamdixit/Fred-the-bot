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
  isLavalinkAvailable,
  radioResolveYouTube,
  radioResolveTrack,
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
  recentMusic: string[];               // local file paths
  recentYTUris: string[];              // youtube URIs already played
  recentAssets: string[];
  active: boolean;
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

// Lavalink track resolution + caching
// Local files don't change between rounds, so we cache resolved tracks by
// path to avoid re-hitting Lavalink (~1-3s per resolve) every transition.
class TrackResolver {
  private cache = new Map<string, RadioTrack>();

  async resolveFile(filePath: string): Promise<RadioTrack | null> {
    const hit = this.cache.get(filePath);
    if (hit) return hit;
    const url = fileToPublicUrl(filePath);
    if (!url) return null;
    const resolved = await radioResolveTrack(url);
    if (resolved) this.cache.set(filePath, resolved);
    return resolved;
  }
}

// YouTube-via-Lavalink playback

async function pickYouTubeTrack(station: RadioStation): Promise<RadioYTTrack | null> {
  const seeds = getYTSeeds();
  // Try up to 4 different seeds before giving up.
  for (let i = 0; i < 4; i++) {
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
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

async function playAsset(station: RadioStation, resolver: TrackResolver, kind: AssetKind, clip: string): Promise<void> {
  const resolved = await resolver.resolveFile(clip);
  if (!resolved) {
    log(`[Radio] · ${kind}: failed to resolve ${path.basename(clip)} via Lavalink`, "radio");
    return;
  }
  const result = await radioPlayTrackBlocking(station.player, resolved.encoded, resolved.duration, 90_000);
  if (!result.ok) {
    log(`[Radio] · ${kind}: playback aborted (${result.reason})`, "radio");
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
  log(
    `[Radio] director config: yt-available=${isLavalinkAvailable()} yt-ratio=${ytRatio.toFixed(2)} seeds=${getYTSeeds().length}`,
    "radio",
  );

  const resolver = new TrackResolver();

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

    // Pick this slot's music source.
    let pickYT: boolean;
    if (musicFiles.length === 0) pickYT = true;
    else if (!ytAvailable) pickYT = false;
    else pickYT = Math.random() < ytRatio;

    if (pickYT) {
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
        await playYouTubeTrack(station, track);
      }
    } else {
      await playLocalMusic(station, resolver, musicFiles);
    }
    if (!station.active) return;

    // Director: in-between segment.
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
    await playAsset(station, resolver, kind, clip);
    if (!station.active) return;

    // 25% chance trackintro after a trackoutro.
    if (kind === "trackoutro" && Math.random() < 0.25) {
      const intros = assetCache.get("trackintro") ?? [];
      if (intros.length > 0) {
        const intro = pickRandom(intros, new Set(station.recentAssets))!;
        pushRecent(station.recentAssets, intro, RECENT_ASSETS_LIMIT);
        log(`[Radio] · DJ transition (trackintro): ${path.basename(intro)}`, "radio");
        await playAsset(station, resolver, "trackintro", intro);
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
        "no public base URL configured. set one of `PUBLIC_BASE_URL`, `RENDER_EXTERNAL_URL`, or `SERVICE_URL` so lavalink can fetch the local audio assets over HTTP.",
    };
  }

  const localFiles = await listAudio(MUSIC_DIR);
  log(`[Radio] starting · base=${baseUrl} · local-files=${localFiles.length}`, "radio");

  const joinResult = await radioJoinVoice(guild.id, voiceChannelId, guild.shardId ?? 0);
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
    recentMusic: [],
    recentYTUris: [],
    recentAssets: [],
    active: true,
  };
  stations.set(guild.id, station);

  log(`[Radio] ON AIR in ${guild.name} (vc ${voiceChannelId}) · local=${localFiles.length}`, "radio");

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
  void radioLeaveVoiceChannel(guildId);
  clearStationPresence(station);
  log(`[Radio] OFF AIR in guild ${guildId} (${reason})`, "radio");
  return true;
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
