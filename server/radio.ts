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

const MUSIC_DIR = path.resolve("music_library");
const ASSETS_DIR = path.resolve("radio_assets");
const ASSET_KINDS = ["advert", "selftalk", "trackintro", "trackoutro", "weirdsound"] as const;
type AssetKind = typeof ASSET_KINDS[number];

const RECENT_MUSIC_LIMIT = 20;
const RECENT_ASSETS_LIMIT = 15;
const STATION_NAME = "Fred FM";

interface RadioStation {
  guildId: string;
  guild: Guild;
  voiceChannelId: string;
  textChannel: TextChannel;
  connection: VoiceConnection;
  player: AudioPlayer;
  recentMusic: string[];
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
  // "Artist - Title" convention
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: "Fred FM", title: base };
}

async function playFileBlocking(station: RadioStation, filePath: string): Promise<void> {
  if (!station.active) return;
  const resource = createAudioResource(filePath, { inlineVolume: true });
  resource.volume?.setVolume(1.0);
  station.player.play(resource);
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      station.player.off(AudioPlayerStatus.Idle, onIdle);
      station.player.off("error", onError);
    };
    const onIdle = () => {
      cleanup();
      resolve();
    };
    const onError = (err: any) => {
      log(`[Radio] player error on ${path.basename(filePath)}: ${err?.message ?? err}`, "radio");
      cleanup();
      resolve();
    };
    station.player.once(AudioPlayerStatus.Idle, onIdle);
    station.player.once("error", onError);
  });
}

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
  } catch {}
}

function clearStationPresence(station: RadioStation): void {
  try {
    station.guild.client.user?.setPresence({ activities: [], status: "online" });
  } catch {}
}

async function sendNowPlaying(station: RadioStation, artist: string, title: string): Promise<void> {
  try {
    await station.textChannel.send({
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: `📻 ${STATION_NAME}` })
          .setTitle(title)
          .setDescription(`by **${artist}**`)
          .setFooter({ text: "non-stop hits and assorted noise" })
          .setColor(0xff5e3a),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (err: any) {
    log(`[Radio] failed to post now-playing embed: ${err.message}`, "radio");
  }
}

async function broadcastLoop(station: RadioStation): Promise<void> {
  while (station.active) {
    const musicFiles = await listAudio(MUSIC_DIR);

    if (musicFiles.length === 0) {
      try {
        await station.textChannel.send({
          content: "no music loaded. drop some `.mp3`/`.wav`/`.ogg` files into `music_library/` and run `/radio` again. broadcast over.",
          allowedMentions: { parse: [] },
        });
      } catch {}
      stopStation(station.guildId, "empty music_library");
      return;
    }

    const assetCache = new Map<AssetKind, string[]>();
    for (const k of ASSET_KINDS) {
      assetCache.set(k, await listAudio(path.join(ASSETS_DIR, k)));
    }

    // ── pick + play music track ────────────────────────────────────────────
    const trackPath = pickRandom(musicFiles, new Set(station.recentMusic))!;
    pushRecent(station.recentMusic, trackPath, RECENT_MUSIC_LIMIT);

    const { artist, title } = parseTrackInfo(trackPath);
    setStationPresence(station, artist);
    await sendNowPlaying(station, artist, title);
    log(`[Radio] ▶ ${artist} — ${title}`, "radio");
    await playFileBlocking(station, trackPath);
    if (!station.active) return;

    // ── director: pick the in-between segment ──────────────────────────────
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

    // ── transition rule: 25% chance trackintro after a trackoutro ─────────
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

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err: any) {
    try { connection.destroy(); } catch {}
    return { ok: false, reason: `couldn't connect to voice: ${err.message}` };
  }

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
  connection.subscribe(player);

  const station: RadioStation = {
    guildId: guild.id,
    guild,
    voiceChannelId,
    textChannel,
    connection,
    player,
    recentMusic: [],
    recentAssets: [],
    active: true,
  };
  stations.set(guild.id, station);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      stopStation(guild.id, "voice connection lost");
    }
  });

  player.on("error", (err: any) => {
    log(`[Radio] player error: ${err?.message ?? err}`, "radio");
  });

  log(`[Radio] ON AIR in ${guild.name} (vc ${voiceChannelId})`, "radio");

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
  try { station.player.stop(true); } catch {}
  try { station.connection.destroy(); } catch {}
  stations.delete(guildId);
  clearStationPresence(station);
  log(`[Radio] OFF AIR in guild ${guildId} (${reason})`, "radio");
  return true;
}

export async function previewLibrary(): Promise<{ music: number; assets: Record<AssetKind, number> }> {
  const music = (await listAudio(MUSIC_DIR)).length;
  const assets = {} as Record<AssetKind, number>;
  for (const k of ASSET_KINDS) {
    assets[k] = (await listAudio(path.join(ASSETS_DIR, k))).length;
  }
  return { music, assets };
}
