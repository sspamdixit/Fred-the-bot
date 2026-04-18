import { Client } from "discord.js";
import { Shoukaku, Connectors } from "shoukaku";
import type { Player } from "shoukaku";
import { log } from "./index";

const LAVALINK_NODES = [
  {
    name: "main",
    url: "lavalink.devamop.in:443",
    auth: "DevamOP",
    secure: true,
  },
  {
    name: "heavencloud",
    url: "89.106.84.59:4000",
    auth: "heavencloud.in",
    secure: false,
  },
  {
    name: "ajieblogs",
    url: "lava-v4.ajieblogs.eu.org:443",
    auth: "https://dsc.gg/ajidevserver",
    secure: true,
  },
];

export interface QueueTrack {
  encoded: string;
  title: string;
  author: string;
  uri: string;
  duration: number;
  isStream: boolean;
  requestedBy: string;
}

export interface GuildQueue {
  player: Player;
  tracks: QueueTrack[];
  current: QueueTrack | null;
  volume: number;
  voiceChannelId: string;
  textChannelId: string;
}

let shoukaku: Shoukaku | null = null;
const queues = new Map<string, GuildQueue>();

export function initMusic(client: Client): void {
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), LAVALINK_NODES, {
    moveOnDisconnect: false,
    resumeByLibrary: false,
    reconnectTries: 3,
    reconnectInterval: 5,
  });

  shoukaku.on("ready", (name) =>
    log(`[Music] Lavalink node "${name}" connected.`, "discord"),
  );
  shoukaku.on("error", (name, err) =>
    log(`[Music] Lavalink node "${name}" error: ${(err as Error).message}`, "discord"),
  );
  shoukaku.on("close", (name, code, reason) =>
    log(`[Music] Lavalink node "${name}" closed (${code}): ${reason}`, "discord"),
  );
  shoukaku.on("disconnect", (name, players, moved) => {
    log(`[Music] Lavalink node "${name}" disconnected (moved=${moved}).`, "discord");
    if (!moved) {
      for (const player of players) {
        queues.delete(player.guildId);
      }
    }
  });
}

export function getQueue(guildId: string): GuildQueue | undefined {
  return queues.get(guildId);
}

export function formatDuration(ms: number): string {
  if (ms === 0) return "LIVE";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function scheduleAutoDisconnect(guildId: string): void {
  setTimeout(async () => {
    const q = queues.get(guildId);
    if (q && !q.current && q.tracks.length === 0) {
      await shoukaku?.leaveVoiceChannel(guildId);
      queues.delete(guildId);
      log(`[Music] Auto-disconnected from guild ${guildId} (queue empty).`, "discord");
    }
  }, 30_000);
}

function attachPlayerEvents(player: Player, guildId: string): void {
  player.on("trackEnd", () => {
    const queue = queues.get(guildId);
    if (!queue) return;

    if (queue.tracks.length === 0) {
      queue.current = null;
      scheduleAutoDisconnect(guildId);
      return;
    }

    const next = queue.tracks.shift()!;
    queue.current = next;
    player.playTrack({ track: { encoded: next.encoded } });
  });

  player.on("trackException", (_track, payload) => {
    log(`[Music] Track exception in guild ${guildId}: ${payload?.exception?.message ?? "unknown"}`, "discord");
    const queue = queues.get(guildId);
    if (!queue) return;

    if (queue.tracks.length === 0) {
      queue.current = null;
      scheduleAutoDisconnect(guildId);
      return;
    }

    const next = queue.tracks.shift()!;
    queue.current = next;
    player.playTrack({ track: { encoded: next.encoded } });
  });

  player.on("trackStuck", () => {
    log(`[Music] Track stuck in guild ${guildId}, skipping.`, "discord");
    player.stopTrack();
  });
}

export async function resolveTrack(
  query: string,
  requestedBy: string,
): Promise<QueueTrack | null> {
  if (!shoukaku) throw new Error("Music not initialised.");

  const node = shoukaku.getIdealNode();
  if (!node) throw new Error("No Lavalink nodes available.");

  const isUrl = /^https?:\/\//i.test(query);
  const identifier = isUrl ? query : `ytsearch:${query}`;

  const result = await node.rest.resolve(identifier);
  if (!result) return null;

  let raw: any;
  if (result.loadType === "search") {
    const tracks = result.data as any[];
    if (!tracks.length) return null;
    raw = tracks[0];
  } else if (result.loadType === "track") {
    raw = result.data;
  } else if (result.loadType === "playlist") {
    const tracks = (result.data as any).tracks as any[];
    if (!tracks.length) return null;
    raw = tracks[0];
  } else {
    return null;
  }

  return {
    encoded: raw.encoded,
    title: raw.info.title,
    author: raw.info.author,
    uri: raw.info.uri,
    duration: raw.info.length,
    isStream: raw.info.isStream,
    requestedBy,
  };
}

export async function joinAndPlay(
  guildId: string,
  voiceChannelId: string,
  textChannelId: string,
  track: QueueTrack,
  shardId = 0,
): Promise<"playing" | "queued"> {
  if (!shoukaku) throw new Error("Music not initialised.");

  let queue = queues.get(guildId);

  if (!queue) {
    const player = await shoukaku.joinVoiceChannel({
      guildId,
      channelId: voiceChannelId,
      shardId,
      deaf: true,
    });

    queue = {
      player,
      tracks: [],
      current: null,
      volume: 100,
      voiceChannelId,
      textChannelId,
    };

    attachPlayerEvents(player, guildId);
    queues.set(guildId, queue);
  }

  if (queue.current || queue.player.paused) {
    queue.tracks.push(track);
    return "queued";
  }

  queue.current = track;
  queue.player.playTrack({ track: { encoded: track.encoded } });
  await queue.player.setVolume(queue.volume / 100);
  return "playing";
}

export async function skipTrack(guildId: string): Promise<QueueTrack | null> {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return null;
  const skipped = queue.current;
  await queue.player.stopTrack();
  return skipped;
}

export async function stopMusic(guildId: string): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.tracks = [];
  queue.current = null;
  await queue.player.stopTrack();
  await shoukaku?.leaveVoiceChannel(guildId);
  queues.delete(guildId);
  return true;
}

export async function pauseMusic(guildId: string): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return false;
  if (queue.player.paused) return false;
  await queue.player.setPaused(true);
  return true;
}

export async function resumeMusic(guildId: string): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return false;
  if (!queue.player.paused) return false;
  await queue.player.setPaused(false);
  return true;
}

export async function setMusicVolume(
  guildId: string,
  volume: number,
): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.volume = Math.max(0, Math.min(100, volume));
  await queue.player.setVolume(queue.volume / 100);
  return true;
}
