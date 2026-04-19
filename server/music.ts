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
  // Stability flags
  isAdvancing: boolean;   // true while advanceQueue is running — blocks joinAndPlay from interrupting
  isStopped: boolean;     // true after stopMusic/disconnect — prevents end-event from re-queuing
}

let shoukaku: Shoukaku | null = null;
const queues = new Map<string, GuildQueue>();
const joiningGuilds = new Set<string>();

// Debounce map: prevents duplicate advanceQueue calls within a short window
const advanceDebounce = new Map<string, number>();

type NowPlayingCallbackFn = (guildId: string, track: QueueTrack, queue: GuildQueue) => void;
type TextNotifyFn = (guildId: string, textChannelId: string, message: string) => void;

let nowPlayingCallback: NowPlayingCallbackFn | null = null;
let textNotifyCallback: TextNotifyFn | null = null;

export function setNowPlayingCallback(cb: NowPlayingCallbackFn): void {
  nowPlayingCallback = cb;
}

export function setTextNotifyCallback(cb: TextNotifyFn): void {
  textNotifyCallback = cb;
}

export function initMusic(client: Client): void {
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), LAVALINK_NODES, {
    moveOnDisconnect: false,
    resumeByLibrary: false,
    reconnectTries: 5,
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
  shoukaku.on("disconnect", (name, count) => {
    log(`[Music] Lavalink node "${name}" disconnected (${count} players affected).`, "discord");
    void handleNodeDisconnect(name);
  });
}

// When a Lavalink node goes down, try to recover active queues on another node
async function handleNodeDisconnect(nodeName: string): Promise<void> {
  if (!shoukaku) return;

  for (const [guildId, queue] of queues.entries()) {
    // Check if this queue's player was on the disconnected node
    const playerNodeName = (queue.player as any)?.node?.name ?? (queue.player as any)?.options?.name;
    if (playerNodeName && playerNodeName !== nodeName) continue;

    // Also skip already-stopped queues
    if (queue.isStopped) continue;

    log(`[Music] Attempting recovery for guild ${guildId} after node "${nodeName}" disconnect.`, "discord");

    const toResume = queue.current;
    const upcomingTracks = [...queue.tracks];
    const { voiceChannelId, textChannelId, volume, loop } = queue;

    // Mark as stopped to prevent stale end events from interfering
    queue.isStopped = true;
    queues.delete(guildId);

    // Small delay to let Shoukaku fully process the disconnect
    await new Promise<void>((r) => setTimeout(r, 2000));

    // Check if another node is available
    const idealNode = shoukaku.getIdealNode();
    if (!idealNode) {
      log(`[Music] No available Lavalink nodes for guild ${guildId} — cannot recover.`, "discord");
      textNotifyCallback?.(guildId, textChannelId, "all lavalink nodes are down, can't keep playing right now. try ?play again in a bit.");
      continue;
    }

    try {
      const newPlayer = await shoukaku.joinVoiceChannel({
        guildId,
        channelId: voiceChannelId,
        shardId: 0,
        deaf: true,
      });

      const newQueue: GuildQueue = {
        player: newPlayer,
        tracks: toResume ? [toResume, ...upcomingTracks] : upcomingTracks,
        current: null,
        volume,
        loop,
        voiceChannelId,
        textChannelId,
        isAdvancing: false,
        isStopped: false,
      };

      attachPlayerEvents(newPlayer, guildId);
      queues.set(guildId, newQueue);

      log(`[Music] Recovery: rejoined voice channel for guild ${guildId}.`, "discord");
      textNotifyCallback?.(guildId, textChannelId, "node dropped — reconnected and resuming queue.");

      await advanceQueue(newPlayer, guildId);
    } catch (err: any) {
      log(`[Music] Recovery failed for guild ${guildId}: ${err.message}`, "discord");
      textNotifyCallback?.(guildId, textChannelId, "tried to recover but the reconnect failed. use ?play to restart.");
    }
  }
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
    if (q && !q.current && q.tracks.length === 0 && !q.isAdvancing) {
      try {
        await shoukaku?.leaveVoiceChannel(guildId);
      } catch { /* ignore */ }
      queues.delete(guildId);
      log(`[Music] Auto-disconnected from guild ${guildId} (queue empty).`, "discord");
    }
  }, 30_000);
}

// Iterative (non-recursive) queue advancer with isAdvancing guard
async function advanceQueue(player: Player, guildId: string): Promise<void> {
  const queue = queues.get(guildId);
  if (!queue) return;

  // Debounce: ignore if another advance just fired within 200ms
  const now = Date.now();
  const last = advanceDebounce.get(guildId) ?? 0;
  if (now - last < 200) return;
  advanceDebounce.set(guildId, now);

  // If already advancing or intentionally stopped, bail out
  if (queue.isAdvancing || queue.isStopped) return;
  queue.isAdvancing = true;

  try {
    // Loop until we either play a track successfully or exhaust the queue
    while (true) {
      const q = queues.get(guildId);
      if (!q || q.isStopped) return;

      // Track looping
      if (q.loop === "track" && q.current) {
        try {
          await player.playTrack({ track: { encoded: q.current.encoded } });
          await player.setGlobalVolume(q.volume);
          nowPlayingCallback?.(guildId, q.current, q);
          return;
        } catch (err: any) {
          log(`[Music] Failed to loop track "${q.current.title}" in guild ${guildId}: ${err.message}`, "discord");
          // Fall through: treat as finished and move to next track
        }
      }

      // Queue looping: push current to end of queue
      if (q.loop === "queue" && q.current) {
        q.tracks.push(q.current);
      }

      q.current = null;

      if (q.tracks.length === 0) {
        scheduleAutoDisconnect(guildId);
        return;
      }

      const next = q.tracks.shift()!;

      try {
        await player.playTrack({ track: { encoded: next.encoded } });
        q.current = next;
        await player.setGlobalVolume(q.volume);
        nowPlayingCallback?.(guildId, next, q);
        return; // Successfully started next track
      } catch (err: any) {
        log(`[Music] Failed to play track "${next.title}" in guild ${guildId}: ${err.message}`, "discord");
        // Track failed — loop will try the next one
      }
    }
  } finally {
    const q = queues.get(guildId);
    if (q) q.isAdvancing = false;
  }
}

function attachPlayerEvents(player: Player, guildId: string): void {
  // Remove any stale listeners before attaching (safety in case of re-attach)
  player.removeAllListeners("end");
  player.removeAllListeners("exception");
  player.removeAllListeners("stuck");

  player.on("end", (event) => {
    const reason = (event as any)?.reason as string | undefined;

    // "replaced" = new track was loaded while something played (intended, already handled)
    // "cleanup"  = node is shutting down (handleNodeDisconnect handles this)
    // "stopped"  = stopTrack() was called (stopMusic/disconnectMusic marks isStopped first)
    if (reason === "replaced" || reason === "cleanup") return;

    const q = queues.get(guildId);
    if (!q || q.isStopped) return;

    void advanceQueue(player, guildId);
  });

  player.on("exception", (event) => {
    const msg = (event as any)?.exception?.message ?? "unknown";
    log(`[Music] Track exception in guild ${guildId}: ${msg}`, "discord");

    const q = queues.get(guildId);
    if (!q || q.isStopped) return;

    void advanceQueue(player, guildId);
  });

  player.on("stuck", () => {
    log(`[Music] Track stuck in guild ${guildId}, skipping.`, "discord");

    const q = queues.get(guildId);
    if (!q || q.isStopped) return;

    void advanceQueue(player, guildId);
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

// Shared helper: create a new queue + player for a guild
async function createQueue(
  guildId: string,
  voiceChannelId: string,
  textChannelId: string,
  shardId: number,
): Promise<GuildQueue> {
  const player = await shoukaku!.joinVoiceChannel({
    guildId,
    channelId: voiceChannelId,
    shardId,
    deaf: true,
  });

  const queue: GuildQueue = {
    player,
    tracks: [],
    current: null,
    volume: 100,
    loop: "none",
    voiceChannelId,
    textChannelId,
    isAdvancing: false,
    isStopped: false,
  };

  attachPlayerEvents(player, guildId);
  queues.set(guildId, queue);
  return queue;
}

// Wait for an in-progress join to complete and return the resulting queue
async function waitForJoin(guildId: string): Promise<GuildQueue | null> {
  return new Promise<GuildQueue | null>((resolve) => {
    const deadline = Date.now() + 5000;
    const interval = setInterval(() => {
      if (!joiningGuilds.has(guildId) || Date.now() > deadline) {
        clearInterval(interval);
        resolve(queues.get(guildId) ?? null);
      }
    }, 50);
  });
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
    if (joiningGuilds.has(guildId)) {
      const q = await waitForJoin(guildId);
      if (q) { q.tracks.push(track); return "queued"; }
    }

    joiningGuilds.add(guildId);
    try {
      queue = await createQueue(guildId, voiceChannelId, textChannelId, shardId);
    } finally {
      joiningGuilds.delete(guildId);
    }
  }

  // If currently advancing or something is playing/paused, add to queue
  if (queue.current || queue.player.paused || queue.isAdvancing) {
    queue.tracks.push(track);
    return "queued";
  }

  queue.current = track;
  await queue.player.playTrack({ track: { encoded: track.encoded } });
  await queue.player.setGlobalVolume(queue.volume);
  nowPlayingCallback?.(guildId, track, queue);
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
    if (joiningGuilds.has(guildId)) {
      const q = await waitForJoin(guildId);
      if (q) { q.tracks.push(...tracks); return "queued"; }
    }

    joiningGuilds.add(guildId);
    try {
      queue = await createQueue(guildId, voiceChannelId, textChannelId, shardId);
    } finally {
      joiningGuilds.delete(guildId);
    }
  }

  if (queue.current || queue.player.paused || queue.isAdvancing) {
    queue.tracks.push(...tracks);
    return "queued";
  }

  const [first, ...rest] = tracks;
  queue.tracks.push(...rest);
  queue.current = first;
  await queue.player.playTrack({ track: { encoded: first.encoded } });
  await queue.player.setGlobalVolume(queue.volume);
  nowPlayingCallback?.(guildId, first, queue);
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
    if (joiningGuilds.has(guildId)) {
      const q = await waitForJoin(guildId);
      if (q) { q.tracks.unshift(track); return "queued"; }
    }

    joiningGuilds.add(guildId);
    try {
      queue = await createQueue(guildId, voiceChannelId, textChannelId, shardId);
    } finally {
      joiningGuilds.delete(guildId);
    }
  }

  if (queue.current || queue.player.paused || queue.isAdvancing) {
    queue.tracks.unshift(track);
    return "queued";
  }

  queue.current = track;
  await queue.player.playTrack({ track: { encoded: track.encoded } });
  await queue.player.setGlobalVolume(queue.volume);
  nowPlayingCallback?.(guildId, track, queue);
  return "playing";
}

export async function skipTrack(guildId: string): Promise<QueueTrack | null> {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return null;
  const skipped = queue.current;
  // stopTrack fires "stopped" reason on end event → advanceQueue handles it
  await queue.player.stopTrack();
  return skipped;
}

export async function stopMusic(guildId: string): Promise<boolean> {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.isStopped = true;
  queue.tracks = [];
  queue.current = null;
  queue.loop = "none";
  try { await queue.player.stopTrack(); } catch { /* ignore */ }
  try { await shoukaku?.leaveVoiceChannel(guildId); } catch { /* ignore */ }
  queues.delete(guildId);
  advanceDebounce.delete(guildId);
  return true;
}

export async function disconnectMusic(guildId: string): Promise<boolean> {
  return stopMusic(guildId);
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
  await queue.player.setGlobalVolume(queue.volume);
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
