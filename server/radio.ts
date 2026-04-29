import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  ActivityType,
  EmbedBuilder,
  type Guild,
  type TextChannel,
} from "discord.js";
import { log } from "./index";
import {
  isLavalinkAvailable,
  radioResolveYouTube,
  radioPlayYouTubeBlocking,
  radioLeaveVoiceChannel,
  type RadioYTTrack,
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

interface RadioStation {
  guildId: string;
  guild: Guild;
  voiceChannelId: string;
  textChannel: TextChannel;
  shardId: number;
  connection: VoiceConnection | null; // null while Lavalink owns the channel
  player: AudioPlayer | null;          // null while Lavalink owns the channel
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

// ── @discordjs/voice connection lifecycle ───────────────────────────────────

async function attachLocalConnection(station: RadioStation): Promise<boolean> {
  // Tear down any existing connection first.
  await detachLocalConnection(station);

  const connection = joinVoiceChannel({
    channelId: station.voiceChannelId,
    guildId: station.guildId,
    adapterCreator: station.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err: any) {
    try { connection.destroy(); } catch { /* ignore */ }
    log(`[Radio] couldn't (re)connect to voice: ${err.message}`, "radio");
    return false;
  }

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
  connection.subscribe(player);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // Only kill the station if this connection is still the live one.
      if (stations.get(station.guildId)?.connection === connection) {
        stopStation(station.guildId, "voice connection lost");
      }
    }
  });

  player.on("error", (err: any) => {
    log(`[Radio] player error: ${err?.message ?? err}`, "radio");
  });

  station.connection = connection;
  station.player = player;
  return true;
}

async function detachLocalConnection(station: RadioStation): Promise<void> {
  const player = station.player;
  const connection = station.connection;
  station.player = null;
  station.connection = null;

  try { player?.stop(true); } catch { /* ignore */ }
  try { connection?.destroy(); } catch { /* ignore */ }
}

async function playFileBlocking(station: RadioStation, filePath: string): Promise<void> {
  if (!station.active) return;

  // Lazy reattach if the connection was given up to Lavalink last round.
  if (!station.player || !station.connection) {
    const ok = await attachLocalConnection(station);
    if (!ok) {
      stopStation(station.guildId, "could not reattach voice connection");
      return;
    }
  }
  const player = station.player!;

  const resource = createAudioResource(filePath, { inlineVolume: true });
  resource.volume?.setVolume(1.0);
  player.play(resource);

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off("error", onError);
    };
    const onIdle = () => { cleanup(); resolve(); };
    const onError = (err: any) => {
      log(`[Radio] player error on ${path.basename(filePath)}: ${err?.message ?? err}`, "radio");
      cleanup();
      resolve();
    };
    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once("error", onError);
  });
}

// ── YouTube-via-Lavalink playback (handoff) ─────────────────────────────────

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

async function playYouTubeBlocking(station: RadioStation, track: RadioYTTrack): Promise<void> {
  if (!station.active) return;

  // Hand the voice channel over from @discordjs/voice to Lavalink.
  await detachLocalConnection(station);
  // Brief delay so the leave packet propagates before Lavalink rejoins.
  await sleep(400);

  pushRecent(station.recentYTUris, track.uri, RECENT_YT_LIMIT);
  setStationPresence(station, track.author);
  await sendNowPlaying(station, track.author, track.title, "YouTube via Lavalink", track.artworkUrl);
  log(`[Radio] ▶ YT ${track.author} — ${track.title}`, "radio");

  const result = await radioPlayYouTubeBlocking(
    station.guildId,
    station.voiceChannelId,
    track,
    station.shardId,
  );

  if (!result.ok) {
    log(`[Radio] YT playback aborted: ${result.reason}`, "radio");
    // Make sure Lavalink released the channel.
    await radioLeaveVoiceChannel(station.guildId);
  }

  // Brief delay before reclaiming the channel.
  await sleep(400);

  if (!station.active) return;
  const reattached = await attachLocalConnection(station);
  if (!reattached) {
    stopStation(station.guildId, "could not reattach voice after YT track");
  }
}

// ── Director / scheduling ───────────────────────────────────────────────────

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

async function broadcastLoop(station: RadioStation): Promise<void> {
  const ytRatio = getYouTubeMixRatio();
  log(
    `[Radio] director config: yt-available=${isLavalinkAvailable()} yt-ratio=${ytRatio.toFixed(2)} seeds=${getYTSeeds().length}`,
    "radio",
  );

  while (station.active) {
    // Re-evaluate sources every loop so a Lavalink node coming online (or
    // going offline) mid-broadcast is picked up without restarting the radio.
    const ytAvailable = isLavalinkAvailable();
    const musicFiles = await listAudio(MUSIC_DIR);
    const assetCache = new Map<AssetKind, string[]>();
    for (const k of ASSET_KINDS) {
      assetCache.set(k, await listAudio(path.join(ASSETS_DIR, k)));
    }

    // ── pick the music source for this slot ──────────────────────────────
    let pickYT: boolean;
    if (musicFiles.length === 0 && !ytAvailable) {
      try {
        await station.textChannel.send({
          content: "no music sources available. drop files into `music_library/` or wire up Lavalink. broadcast over.",
          allowedMentions: { parse: [] },
        });
      } catch { /* ignore */ }
      stopStation(station.guildId, "no music sources");
      return;
    } else if (musicFiles.length === 0) {
      pickYT = true;                  // local empty → must use YT
    } else if (!ytAvailable) {
      pickYT = false;                 // lavalink down → must use local
    } else {
      pickYT = Math.random() < ytRatio;
    }

    // ── play music ───────────────────────────────────────────────────────
    if (pickYT) {
      const track = await pickYouTubeTrack(station);
      if (!track) {
        log(`[Radio] YT pick failed — falling back to local file`, "radio");
        if (musicFiles.length > 0) {
          await playLocalMusic(station, musicFiles);
        } else {
          // No fallback available — wait briefly and try again next round.
          await sleep(5_000);
          continue;
        }
      } else {
        await playYouTubeBlocking(station, track);
      }
    } else {
      await playLocalMusic(station, musicFiles);
    }
    if (!station.active) return;

    // ── director: pick the in-between segment ───────────────────────────
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
    await playFileBlocking(station, clip);
    if (!station.active) return;

    // ── transition rule: 25% chance trackintro after a trackoutro ────────
    if (kind === "trackoutro" && Math.random() < 0.25) {
      const intros = assetCache.get("trackintro") ?? [];
      if (intros.length > 0) {
        const intro = pickRandom(intros, new Set(station.recentAssets))!;
        pushRecent(station.recentAssets, intro, RECENT_ASSETS_LIMIT);
        log(`[Radio] · DJ transition (trackintro): ${path.basename(intro)}`, "radio");
        await playFileBlocking(station, intro);
        if (!station.active) return;
      }
    }
  }
}

async function playLocalMusic(station: RadioStation, musicFiles: string[]): Promise<void> {
  const trackPath = pickRandom(musicFiles, new Set(station.recentMusic))!;
  pushRecent(station.recentMusic, trackPath, RECENT_MUSIC_LIMIT);
  const { artist, title } = parseTrackInfo(trackPath);
  setStationPresence(station, artist);
  await sendNowPlaying(station, artist, title, "Local Library");
  log(`[Radio] ▶ LOCAL ${artist} — ${title}`, "radio");
  await playFileBlocking(station, trackPath);
}

// ── public lifecycle ────────────────────────────────────────────────────────

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

  const localFiles = await listAudio(MUSIC_DIR);
  const ytReady = isLavalinkAvailable();
  if (localFiles.length === 0 && !ytReady) {
    return {
      ok: false,
      reason: "no music sources available. drop `.mp3`/`.wav`/`.ogg` files into `music_library/`, or wait for a Lavalink node to come online.",
    };
  }

  const station: RadioStation = {
    guildId: guild.id,
    guild,
    voiceChannelId,
    textChannel,
    shardId: guild.shardId ?? 0,
    connection: null,
    player: null,
    recentMusic: [],
    recentYTUris: [],
    recentAssets: [],
    active: true,
  };
  stations.set(guild.id, station);

  const attached = await attachLocalConnection(station);
  if (!attached) {
    stations.delete(guild.id);
    return { ok: false, reason: "couldn't connect to voice — try again." };
  }

  log(`[Radio] ON AIR in ${guild.name} (vc ${voiceChannelId}) · local=${localFiles.length} yt=${ytReady}`, "radio");

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
  void detachLocalConnection(station);
  void radioLeaveVoiceChannel(guildId); // in case Lavalink was holding the channel
  stations.delete(guildId);
  clearStationPresence(station);
  log(`[Radio] OFF AIR in guild ${guildId} (${reason})`, "radio");
  return true;
}

export async function previewLibrary(): Promise<{
  music: number;
  assets: Record<AssetKind, number>;
  youtube: boolean;
}> {
  const music = (await listAudio(MUSIC_DIR)).length;
  const assets = {} as Record<AssetKind, number>;
  for (const k of ASSET_KINDS) {
    assets[k] = (await listAudio(path.join(ASSETS_DIR, k))).length;
  }
  return { music, assets, youtube: isLavalinkAvailable() };
}
