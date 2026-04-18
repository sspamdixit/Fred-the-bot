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

export type LoopMode = "none" | "track" | "queue";

export interface GuildQueue {
  player: Player;
  tracks: QueueTrack[];
  current: QueueTrack | null;
  volume: number;
  loop: LoopMode;
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

export function parseSeekTime(input: string): number | null {
  // Supports: "90", "1:30", "1:30:00"
  const parts = input.trim().split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 1) return parts[0] * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
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

    if (queue.loop === "track" && queue.current) {
      player.playTrack({ track: { encoded: queue.current.encoded } });
      return;
    }

    if (queue.loop === "queue" && queue.current) {
      queue.tracks.push(queue.current);
    }

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

export interface SearchResult {
  title: string;
  author: string;
  uri: string;
  duration: number;
  isStream: boolean;
}

export async function searchTracks(query: string, limit = 5): Promise<SearchResult[]> {
  if (!shoukaku) return [];

  const node = shoukaku.getIdealNode();
  if (!node) return [];

  const isUrl = /^https?:\/\//i.test(query);
  const identifier = isUrl ? query : `ytsearch:${query}`;

  try {
    const result = await node.rest.resolve(identifier);
    if (!result) return [];

    const toResult = (raw: any): SearchResult => ({
      title: raw.info.title,
      author: raw.info.author,
      uri: raw.info.uri,
      duration: raw.info.length,
      isStream: raw.info.isStream,
    });

    if (result.loadType === "search") {
      return (result.data as any[]).slice(0, limit).map(toResult);
    }
    if (result.loadType === "track") {
      return [toResult(result.data)];
    }
    if (result.loadType === "playlist") {
      const tracks = (result.data as any).tracks as any[];
      return tracks.slice(0, limit).map(toResult);
    }
  } catch {
    // silently return empty on search errors
  }

  return [];
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

export async function resolvePlaylist(
  query: string,
  requestedBy: string,
): Promise<{ tracks: QueueTrack[]; playlistName: string | null }> {
  if (!shoukaku) throw new Error("Music not initialised.");

  const node = shoukaku.getIdealNode();
  if (!node) throw new Error("No Lavalink nodes available.");

  const isUrl = /^https?:\/\//i.test(query);
  const identifier = isUrl ? query : `ytsearch:${query}`;

  const result = await node.rest.resolve(identifier);
  if (!result) return { tracks: [], playlistName: null };

  const toTrack = (raw: any): QueueTrack => ({
    encoded: raw.encoded,
    title: raw.info.title,
    author: raw.info.author,
    uri: raw.info.uri,
    duration: raw.info.length,
    isStream: raw.info.isStream,
    requestedBy,
  });

  if (result.loadType === "playlist") {
    const data = result.data as any;
    const tracks: QueueTrack[] = (data.tracks as any[]).map(toTrack);
    return { tracks, playlistName: data.info?.name ?? null };
  }

  if (result.loadType === "search") {
    const tracks = result.data as any[];
    if (!tracks.length) return { tracks: [], playlistName: null };
    return { tracks: [toTrack(tracks[0])], playlistName: null };
  }

  if (result.loadType === "track") {
    return { tracks: [toTrack(result.data)], playlistName: null };
  }

  return { tracks: [], playlistName: null };
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
      loop: "none",
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

export async function joinAndPlayMultiple(
  guildId: string,
  voiceChannelId: string,
  textChannelId: string,
  tracks: QueueTrack[],
  shardId = 0,
): Promise<"playing" | "queued"> {
  if (!shoukaku) throw new Error("Music not initialised.");
  if (!tracks.length) throw new Error("No tracks provided.");

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
      loop: "none",
      voiceChannelId,
      textChannelId,
    };

    attachPlayerEvents(player, guildId);
    queues.set(guildId, queue);
  }

  if (queue.current || queue.player.paused) {
    queue.tracks.push(...tracks);
    return "queued";
  }

  const [first, ...rest] = tracks;
  queue.tracks.push(...rest);
  queue.current = first;
  queue.player.playTrack({ track: { encoded: first.encoded } });
  await queue.player.setVolume(queue.volume / 100);
  return "playing";
}

export async function addToFront(
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
      loop: "none",
      voiceChannelId,
      textChannelId,
    };

    attachPlayerEvents(player, guildId);
    queues.set(guildId, queue);
  }

  if (queue.current || queue.player.paused) {
    queue.tracks.unshift(track);
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
  queue.loop = "none";
  await queue.player.stopTrack();
  await shoukaku?.leaveVoiceChannel(guildId);
  queues.delete(guildId);
  return true;
}

export async function disconnectMusic(guildId: string): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.tracks = [];
  queue.current = null;
  queue.loop = "none";
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

export function shuffleQueue(guildId: string): boolean {
  const queue = queues.get(guildId);
  if (!queue || queue.tracks.length < 2) return false;
  for (let i = queue.tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
  }
  return true;
}

export function setLoop(guildId: string, mode: LoopMode): boolean {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.loop = mode;
  return true;
}

export function cycleLoop(guildId: string): LoopMode | null {
  const queue = queues.get(guildId);
  if (!queue) return null;
  const next: Record<LoopMode, LoopMode> = { none: "track", track: "queue", queue: "none" };
  queue.loop = next[queue.loop];
  return queue.loop;
}

export function removeTrack(guildId: string, index: number): QueueTrack | null {
  const queue = queues.get(guildId);
  if (!queue || index < 1 || index > queue.tracks.length) return null;
  const [removed] = queue.tracks.splice(index - 1, 1);
  return removed ?? null;
}

export function moveTrack(guildId: string, from: number, to: number): boolean {
  const queue = queues.get(guildId);
  if (!queue) return false;
  if (from < 1 || from > queue.tracks.length) return false;
  if (to < 1 || to > queue.tracks.length) return false;
  if (from === to) return true;
  const [track] = queue.tracks.splice(from - 1, 1);
  queue.tracks.splice(to - 1, 0, track);
  return true;
}

export function clearQueue(guildId: string): number {
  const queue = queues.get(guildId);
  if (!queue) return 0;
  const count = queue.tracks.length;
  queue.tracks = [];
  return count;
}

export async function seekTrack(guildId: string, ms: number): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return false;
  if (queue.current.isStream) return false;
  await queue.player.seekTo(ms);
  return true;
}
