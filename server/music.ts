import { Client } from "discord.js";
import { Shoukaku, Connectors } from "shoukaku";
import type { Player } from "shoukaku";
import { log } from "./index";

interface LavalinkNodeConfig {
  name: string;
  url: string;
  auth: string;
  secure: boolean;
}

const DEFAULT_LAVALINK_NODES: LavalinkNodeConfig[] = [
  {
    name: "heavencloud",
    url: "89.106.84.59:4000",
    auth: "heavencloud.in",
    secure: false,
  },
  {
    name: "jirayu",
    url: "lavalink.jirayu.net:13592",
    auth: "youshallnotpass",
    secure: false,
  },
  {
    name: "jirayu-ssl",
    url: "lavalink.jirayu.net:443",
    auth: "youshallnotpass",
    secure: true,
  },
  {
    name: "serenetia-v4",
    url: "lavalinkv4.serenetia.com:443",
    auth: "https://dsc.gg/ajidevserver",
    secure: true,
  },
  {
    name: "serenetia-universal",
    url: "lavalink.serenetia.com:443",
    auth: "https://dsc.gg/ajidevserver",
    secure: true,
  },
  {
    name: "millohost",
    url: "lava-v4.millohost.my.id:443",
    auth: "https://discord.gg/mjS5J2K3ep",
    secure: true,
  },
  {
    name: "ajieblogs",
    url: "lava-v4.ajieblogs.eu.org:443",
    auth: "https://dsc.gg/ajidevserver",
    secure: true,
  },
];

function parseBoolean(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(value ?? "");
}

function normalizeLavalinkNode(raw: any, fallbackName: string): LavalinkNodeConfig | null {
  const name = String(raw?.name || fallbackName).trim();
  const url = String(raw?.url || raw?.host || "").trim();
  const auth = String(raw?.auth || raw?.password || "").trim();
  const secure = typeof raw?.secure === "boolean" ? raw.secure : parseBoolean(String(raw?.secure ?? ""));

  if (!name || !url || !auth) return null;
  return { name, url, auth, secure };
}

function getLavalinkNodes(): LavalinkNodeConfig[] {
  const rawNodes = process.env.LAVALINK_NODES?.trim();

  if (rawNodes) {
    try {
      const parsed = JSON.parse(rawNodes);
      const nodeList = Array.isArray(parsed) ? parsed : [parsed];
      const nodes = nodeList
        .map((node, index) => normalizeLavalinkNode(node, `node-${index + 1}`))
        .filter((node): node is LavalinkNodeConfig => Boolean(node));

      if (nodes.length > 0) return nodes;
      log("[Music] LAVALINK_NODES was set but contained no valid nodes.", "discord");
    } catch (err: any) {
      log(`[Music] Could not parse LAVALINK_NODES JSON: ${err.message}`, "discord");
    }
  }

  const singleNode = normalizeLavalinkNode(
    {
      name: process.env.LAVALINK_NAME || "custom",
      url: process.env.LAVALINK_URL,
      auth: process.env.LAVALINK_AUTH || process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE,
    },
    "custom",
  );

  return singleNode ? [singleNode] : DEFAULT_LAVALINK_NODES;
}

export interface QueueTrack {
  encoded: string;
  title: string;
  author: string;
  uri: string;
  duration: number;
  isStream: boolean;
  requestedBy: string;
  artworkUrl: string | null;
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
  resumePositionMs?: number;
  // Autoplay state
  autoplay: boolean;
  recentSeeds: QueueTrack[];          // last few user-queued tracks (for seeding similar songs)
  recentlyPlayedUris: string[];       // URIs already played to avoid immediate repeats
  isFetchingAutoplay: boolean;        // guard against concurrent autoplay fetches
  // Stability flags
  isAdvancing: boolean;   // true while advanceQueue is running — blocks joinAndPlay from interrupting
  isStopped: boolean;     // true after stopMusic/disconnect — prevents end-event from re-queuing
  // Recovery state — used to retry the current track after a lag/stuck event before skipping.
  recoveryAttempts: number;            // number of consecutive recovery attempts on the *current* track
  recoveryWindowStartedAt: number;     // timestamp when the current recovery streak started
  isRecovering: boolean;               // true while a recovery attempt is in flight
  lastTrackStartedAt: number;          // timestamp the current track actually started playing
  // Node-health watchdog state — used to auto-migrate to a healthier node when
  // the current one is degraded (high penalties / dropped frames) for too long.
  nodeUnhealthySince: number;          // timestamp the current node first looked unhealthy, or 0
  lastAutoMigrateAt: number;           // timestamp of the last auto-migration, for cooldown
  isAutoMigrating: boolean;            // guard so watchdog doesn't fire concurrently
}

// Recovery tuning — try this many times within the window before giving up and skipping.
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_WINDOW_MS = 90_000;

// Node-health watchdog tuning.
const NODE_HEALTH_CHECK_INTERVAL_MS = 15_000;        // how often to poll node health
const NODE_UNHEALTHY_DURATION_MS = 30_000;           // node must be bad for this long before migrating
const NODE_AUTO_MIGRATE_COOLDOWN_MS = 120_000;       // don't auto-migrate the same guild more often than this
const NODE_PENALTY_BAD_THRESHOLD = 75;               // Shoukaku penalty score considered "degraded"
const NODE_PENALTY_IMPROVEMENT_THRESHOLD = 30;       // require alternative to be at least this much better
const NODE_FRAME_DEFICIT_THRESHOLD = 100;            // dropped+nulled opus frames per stats window

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
  const nodes = getLavalinkNodes();

  if (!nodes.length) {
    shoukaku = null;
    log("[Music] No Lavalink nodes configured. Music commands are disabled.", "discord");
    return;
  }

  log(`[Music] Initialising Lavalink with nodes: ${nodes.map((node) => node.name).join(", ")}`, "discord");

  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
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

  startNodeHealthWatchdog();
}

// ── Node-health watchdog ────────────────────────────────────────────────────
// Periodically inspects the Lavalink node serving each active queue. If the
// node looks degraded (high penalty score, dropped/nulled opus frames) for a
// sustained window AND a meaningfully better node is available, the bot will
// auto-migrate the player to the healthier node — preserving the now-playing
// song and queue. This catches the "node is connected but laggy" case that
// neither the node-disconnect handler nor the per-track stuck/exception
// recovery would notice.

let nodeHealthWatchdogTimer: ReturnType<typeof setInterval> | null = null;

function startNodeHealthWatchdog(): void {
  if (nodeHealthWatchdogTimer) clearInterval(nodeHealthWatchdogTimer);
  nodeHealthWatchdogTimer = setInterval(() => {
    void runNodeHealthCheck();
  }, NODE_HEALTH_CHECK_INTERVAL_MS);
  nodeHealthWatchdogTimer.unref?.();
}

function getPlayerNode(player: Player): any | null {
  return (player as any)?.node ?? null;
}

function isNodeUnhealthy(node: any): boolean {
  if (!node) return false;
  const penalties = Number(node.penalties ?? 0);
  if (Number.isFinite(penalties) && penalties >= NODE_PENALTY_BAD_THRESHOLD) return true;

  const frames = node?.stats?.frameStats;
  if (frames) {
    const deficit = Number(frames.deficit ?? 0) + Number(frames.nulled ?? 0);
    if (deficit >= NODE_FRAME_DEFICIT_THRESHOLD) return true;
  }
  return false;
}

async function runNodeHealthCheck(): Promise<void> {
  if (!shoukaku || queues.size === 0) return;
  const now = Date.now();

  for (const [guildId, queue] of queues.entries()) {
    if (queue.isStopped || queue.isAutoMigrating || queue.isRecovering || queue.isAdvancing) continue;
    if (!queue.current) continue; // nothing playing — nothing to protect

    const currentNode = getPlayerNode(queue.player);
    if (!currentNode) continue;

    const unhealthy = isNodeUnhealthy(currentNode);

    if (!unhealthy) {
      // Node looks fine — clear any pending unhealthy streak.
      if (queue.nodeUnhealthySince !== 0) queue.nodeUnhealthySince = 0;
      continue;
    }

    if (queue.nodeUnhealthySince === 0) {
      queue.nodeUnhealthySince = now;
      continue;
    }

    if (now - queue.nodeUnhealthySince < NODE_UNHEALTHY_DURATION_MS) continue;
    if (now - queue.lastAutoMigrateAt < NODE_AUTO_MIGRATE_COOLDOWN_MS) continue;

    // Find a meaningfully better alternative — avoid migrating if the rest of
    // the pool is just as bad (or worse), which would only cause flapping.
    const candidate = shoukaku.getIdealNode();
    if (!candidate || candidate.name === currentNode.name) {
      // No better option right now; reset the streak so we re-evaluate fresh.
      queue.nodeUnhealthySince = now;
      continue;
    }

    const currentPenalties = Number(currentNode.penalties ?? 0);
    const candidatePenalties = Number((candidate as any).penalties ?? 0);
    if (
      Number.isFinite(currentPenalties) &&
      Number.isFinite(candidatePenalties) &&
      currentPenalties - candidatePenalties < NODE_PENALTY_IMPROVEMENT_THRESHOLD
    ) {
      queue.nodeUnhealthySince = now;
      continue;
    }

    // Trigger the auto-migration. Mark cooldown immediately so a slow migration
    // can't cause a second one to queue up behind it.
    queue.isAutoMigrating = true;
    queue.lastAutoMigrateAt = now;
    queue.nodeUnhealthySince = 0;

    const fromName = currentNode.name ?? "unknown";
    const toName = candidate.name ?? "unknown";
    log(
      `[Music] Auto-migrating guild ${guildId}: node "${fromName}" degraded (penalties ${currentPenalties.toFixed(0)}) ` +
      `→ trying "${toName}" (penalties ${candidatePenalties.toFixed(0)}).`,
      "discord",
    );
    textNotifyCallback?.(
      guildId,
      queue.textChannelId,
      `playback's getting laggy — switching to a fresher audio node real quick.`,
    );

    try {
      const result = await reconnectMusic(guildId);
      if (result.ok) {
        log(`[Music] Auto-migration succeeded for guild ${guildId} (now on "${result.nodeName ?? "unknown"}").`, "discord");
      } else {
        log(`[Music] Auto-migration failed for guild ${guildId}: ${result.message}`, "discord");
      }
    } catch (err: any) {
      log(`[Music] Auto-migration threw for guild ${guildId}: ${err.message}`, "discord");
    } finally {
      // The new queue object is what's in the map after reconnectMusic; clear
      // the flag on whichever queue is now associated with this guild.
      const post = queues.get(guildId);
      if (post) post.isAutoMigrating = false;
    }
  }
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
    const resumePositionMs = getResumePositionMs(queue, toResume);

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
        resumePositionMs,
        autoplay: queue.autoplay,
        recentSeeds: [...queue.recentSeeds],
        recentlyPlayedUris: [...queue.recentlyPlayedUris],
        isFetchingAutoplay: false,
        isAdvancing: false,
        isStopped: false,
        recoveryAttempts: 0,
        recoveryWindowStartedAt: 0,
        isRecovering: false,
        lastTrackStartedAt: 0,
        nodeUnhealthySince: 0,
        lastAutoMigrateAt: Date.now(),
        isAutoMigrating: false,
      };

      attachPlayerEvents(newPlayer, guildId);
      queues.set(guildId, newQueue);

      log(`[Music] Recovery: rejoined voice channel for guild ${guildId}.`, "discord");
      const resumeMessage = resumePositionMs > 0
        ? `node dropped — reconnected and resuming from ${formatDuration(resumePositionMs)}.`
        : "node dropped — reconnected and resuming queue.";
      textNotifyCallback?.(guildId, textChannelId, resumeMessage);

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

// Defensively wipe any Lavalink filters before starting playback. Speed/pitch
// warping during music ("plays too fast" or "too slow") is almost always a
// stale `timescale` filter that survived a previous track, recovery attempt,
// or node migration. Clearing filters every play guarantees each track starts
// at neutral 1.0× speed / pitch / rate.
async function resetPlayerFilters(player: Player, guildId: string): Promise<void> {
  try {
    await player.clearFilters();
  } catch (err: any) {
    log(`[Music] Failed to clear filters in guild ${guildId}: ${err.message}`, "discord");
  }
}

function getResumePositionMs(queue: GuildQueue, track: QueueTrack | null): number {
  if (!track || track.isStream || track.duration <= 0) return 0;

  const position = Number(queue.player.position);
  if (!Number.isFinite(position) || position < 1000) return 0;

  const latestSafePosition = Math.max(0, track.duration - 1000);
  return Math.min(Math.floor(position), latestSafePosition);
}

async function applyResumePosition(
  player: Player,
  guildId: string,
  track: QueueTrack,
  queue: GuildQueue,
): Promise<void> {
  const resumePositionMs = queue.resumePositionMs ?? 0;
  queue.resumePositionMs = undefined;

  if (resumePositionMs <= 0 || track.isStream) return;

  try {
    await player.seekTo(resumePositionMs);
    log(`[Music] Resumed "${track.title}" in guild ${guildId} at ${formatDuration(resumePositionMs)}.`, "discord");
  } catch (err: any) {
    log(`[Music] Failed to restore position for "${track.title}" in guild ${guildId}: ${err.message}`, "discord");
  }
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

// Per-guild autoplay preference, persists even when no queue/player exists
const guildAutoplayPrefs = new Map<string, boolean>();

export function setAutoplay(guildId: string, enabled: boolean): boolean {
  guildAutoplayPrefs.set(guildId, enabled);
  const q = queues.get(guildId);
  if (q) q.autoplay = enabled;
  return enabled;
}

export function isAutoplayEnabled(guildId: string): boolean {
  const q = queues.get(guildId);
  if (q) return q.autoplay;
  return guildAutoplayPrefs.get(guildId) ?? false;
}

export function getAutoplayPref(guildId: string): boolean {
  return guildAutoplayPrefs.get(guildId) ?? false;
}

function extractYouTubeVideoId(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1) || null;
    }
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v");
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchAutoplayTracks(
  seed: QueueTrack,
  count: number,
  exclude: Set<string>,
): Promise<QueueTrack[]> {
  if (!shoukaku) return [];
  const node = shoukaku.getIdealNode();
  if (!node) return [];

  const candidates: QueueTrack[] = [];
  const seen = new Set<string>(exclude);

  const collect = (raw: any): void => {
    if (!raw?.encoded || !raw.info) return;
    if (raw.info.isStream) return;
    const uri = raw.info.uri;
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    candidates.push({
      encoded: raw.encoded,
      title: raw.info.title,
      author: raw.info.author,
      uri,
      duration: raw.info.length,
      isStream: !!raw.info.isStream,
      requestedBy: "autoplay",
      artworkUrl: raw.info.artworkUrl ?? null,
    });
  };

  // Strategy 1: YouTube radio mix from the seed video
  const videoId = extractYouTubeVideoId(seed.uri);
  if (videoId) {
    try {
      const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
      const result = await node.rest.resolve(mixUrl);
      if (result?.loadType === "playlist") {
        const tracks = ((result.data as any).tracks ?? []) as any[];
        // Skip the first one — it's the seed track itself
        for (const t of tracks.slice(1)) collect(t);
      }
    } catch { /* ignore — fall back to search */ }
  }

  // Strategy 2: artist search as a backup or top-up
  if (candidates.length < count && seed.author) {
    try {
      const result = await node.rest.resolve(`ytsearch:${seed.author} mix`);
      if (result?.loadType === "search") {
        for (const t of (result.data as any[])) collect(t);
      }
    } catch { /* ignore */ }
  }

  return candidates.slice(0, count);
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
          await resetPlayerFilters(player, guildId);
          await player.playTrack({ track: { encoded: q.current.encoded } });
          await player.setGlobalVolume(q.volume);
          await applyResumePosition(player, guildId, q.current, q);
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

      // Capture the just-finished track for autoplay seeding & repeat avoidance.
      // Only autoplay-fetched tracks are added to the exclusion list — user-queued
      // tracks stay eligible so autoplay can resurface them as discovery picks.
      if (q.current) {
        q.recentSeeds.push(q.current);
        if (q.recentSeeds.length > 5) q.recentSeeds.shift();
        if (q.current.requestedBy === "autoplay") {
          q.recentlyPlayedUris.push(q.current.uri);
          if (q.recentlyPlayedUris.length > 50) q.recentlyPlayedUris.shift();
        }
      }

      q.current = null;

      // Autoplay: when the queue runs dry, fetch similar tracks based on the last seed.
      // Only when not looping the whole queue (queue-loop is exclusive of autoplay).
      if (q.tracks.length === 0 && q.autoplay && q.loop !== "queue" && !q.isFetchingAutoplay) {
        const seed = q.recentSeeds[q.recentSeeds.length - 1];
        if (seed) {
          q.isFetchingAutoplay = true;
          try {
            const exclude = new Set(q.recentlyPlayedUris);
            const fetched = await fetchAutoplayTracks(seed, 5, exclude);
            if (fetched.length) {
              q.tracks.push(...fetched);
              log(`[Music:autoplay] Queued ${fetched.length} tracks based on "${seed.title}" in guild ${guildId}.`, "discord");
              textNotifyCallback?.(guildId, q.textChannelId, `🎶 autoplay queued **${fetched.length}** similar tracks.`);
            } else {
              log(`[Music:autoplay] No similar tracks found for "${seed.title}" in guild ${guildId}.`, "discord");
            }
          } catch (err: any) {
            log(`[Music:autoplay] Fetch failed in guild ${guildId}: ${err.message}`, "discord");
          } finally {
            q.isFetchingAutoplay = false;
          }
        }
      }

      if (q.tracks.length === 0) {
        scheduleAutoDisconnect(guildId);
        return;
      }

      const next = q.tracks.shift()!;

      try {
        await resetPlayerFilters(player, guildId);
        await player.playTrack({ track: { encoded: next.encoded } });
        q.current = next;
        await player.setGlobalVolume(q.volume);
        await applyResumePosition(player, guildId, next, q);
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

// Try to recover the currently-playing track after a stuck/exception event by
// replaying it from its last known position. Only after a few failed attempts
// within a short window do we give up and advance the queue.
async function attemptRecovery(
  player: Player,
  guildId: string,
  cause: "stuck" | "exception",
  causeMessage: string,
): Promise<void> {
  const q = queues.get(guildId);
  if (!q || q.isStopped || q.isRecovering || q.isAdvancing) return;
  if (!q.current) {
    void advanceQueue(player, guildId);
    return;
  }

  const now = Date.now();
  // Reset the recovery streak if the window has elapsed since the streak began.
  if (q.recoveryAttempts > 0 && now - q.recoveryWindowStartedAt > RECOVERY_WINDOW_MS) {
    q.recoveryAttempts = 0;
  }
  if (q.recoveryAttempts === 0) {
    q.recoveryWindowStartedAt = now;
  }

  if (q.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    log(`[Music] Recovery exhausted for "${q.current.title}" in guild ${guildId} (${cause}: ${causeMessage}). Skipping.`, "discord");
    textNotifyCallback?.(guildId, q.textChannelId, `couldn't recover **${q.current.title}** after a few tries — skipping.`);
    q.recoveryAttempts = 0;
    void advanceQueue(player, guildId);
    return;
  }

  q.recoveryAttempts += 1;
  q.isRecovering = true;

  const track = q.current;
  // Compute the position to resume from: prefer the player's current reported
  // position if it looks valid, otherwise re-use whatever resume point we had.
  const resumeFromMs = getResumePositionMs(q, track);

  log(
    `[Music] Recovery attempt ${q.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} for "${track.title}" in guild ${guildId} ` +
    `(${cause}: ${causeMessage}) — replaying from ${formatDuration(resumeFromMs)}.`,
    "discord",
  );

  if (q.recoveryAttempts === 1) {
    textNotifyCallback?.(guildId, q.textChannelId, `playback hiccup on **${track.title}** — trying to recover…`);
  }

  try {
    await resetPlayerFilters(player, guildId);
    await player.playTrack({ track: { encoded: track.encoded } });
    await player.setGlobalVolume(q.volume);
    if (resumeFromMs > 0 && !track.isStream) {
      try {
        await player.seekTo(resumeFromMs);
      } catch (err: any) {
        log(`[Music] Recovery seek failed for "${track.title}" in guild ${guildId}: ${err.message}`, "discord");
      }
    }
  } catch (err: any) {
    log(`[Music] Recovery replay failed for "${track.title}" in guild ${guildId}: ${err.message}`, "discord");
    // Replay itself failed — fall through to advancing the queue.
    const cur = queues.get(guildId);
    if (cur) cur.isRecovering = false;
    void advanceQueue(player, guildId);
    return;
  }

  // Release the recovery lock shortly after — long enough that the player has
  // a chance to actually start, but short enough that the next stuck/exception
  // can trigger another attempt if needed.
  setTimeout(() => {
    const cur = queues.get(guildId);
    if (cur) cur.isRecovering = false;
  }, 3_000);
}

function attachPlayerEvents(player: Player, guildId: string): void {
  // Remove any stale listeners before attaching (safety in case of re-attach)
  player.removeAllListeners("start");
  player.removeAllListeners("end");
  player.removeAllListeners("exception");
  player.removeAllListeners("stuck");

  player.on("start", () => {
    const q = queues.get(guildId);
    if (!q) return;
    q.lastTrackStartedAt = Date.now();
    // If the player has been streaming smoothly long enough, treat any earlier
    // recovery streak as resolved. This is also handled lazily in attemptRecovery
    // via the time window, but resetting here keeps state tidy.
  });

  player.on("end", (event) => {
    const reason = (event as any)?.reason as string | undefined;

    // "replaced" = new track was loaded while something played (intended, already handled)
    // "cleanup"  = node is shutting down (handleNodeDisconnect handles this)
    // "stopped"  = stopTrack() was called (stopMusic/disconnectMusic marks isStopped first)
    if (reason === "replaced" || reason === "cleanup") return;

    const q = queues.get(guildId);
    if (!q || q.isStopped) return;

    // If we just finished a track cleanly (i.e. it actually ended), clear any
    // lingering recovery counters before moving on to the next song.
    if (reason === "finished") {
      q.recoveryAttempts = 0;
      q.recoveryWindowStartedAt = 0;
    }

    // If a recovery replay is in flight, the "end" event is a side-effect of
    // the replay itself and should not advance the queue.
    if (q.isRecovering) return;

    void advanceQueue(player, guildId);
  });

  player.on("exception", (event) => {
    const msg = (event as any)?.exception?.message ?? "unknown";
    log(`[Music] Track exception in guild ${guildId}: ${msg}`, "discord");

    const q = queues.get(guildId);
    if (!q || q.isStopped) return;

    void attemptRecovery(player, guildId, "exception", msg);
  });

  player.on("stuck", (event) => {
    const thresholdMs = (event as any)?.thresholdMs;
    log(`[Music] Track stuck in guild ${guildId}${thresholdMs ? ` (threshold ${thresholdMs}ms)` : ""}, attempting recovery.`, "discord");

    const q = queues.get(guildId);
    if (!q || q.isStopped) return;

    void attemptRecovery(player, guildId, "stuck", thresholdMs ? `threshold ${thresholdMs}ms` : "no threshold");
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
    artworkUrl: raw.info.artworkUrl ?? null,
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
    artworkUrl: raw.info.artworkUrl ?? null,
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
    autoplay: guildAutoplayPrefs.get(guildId) ?? false,
    recentSeeds: [],
    recentlyPlayedUris: [],
    isFetchingAutoplay: false,
    isAdvancing: false,
    isStopped: false,
    recoveryAttempts: 0,
    recoveryWindowStartedAt: 0,
    isRecovering: false,
    lastTrackStartedAt: 0,
    nodeUnhealthySince: 0,
    lastAutoMigrateAt: Date.now(),
    isAutoMigrating: false,
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

export type ReconnectResult =
  | { ok: true; resumedAt: number; trackTitle: string | null; nodeName: string | null }
  | { ok: false; reason: "no-queue" | "no-node" | "rejoin-failed"; message: string };

// Force the bot to leave its current Lavalink node and rejoin voice on a fresh
// node, preserving the now-playing song (resumed from its last position) and
// the rest of the queue. Useful when playback feels rough but no error fired.
export async function reconnectMusic(guildId: string): Promise<ReconnectResult> {
  if (!shoukaku) {
    return { ok: false, reason: "no-node", message: "music engine not initialised." };
  }

  const queue = queues.get(guildId);
  if (!queue) {
    return { ok: false, reason: "no-queue", message: "i'm not playing anything in this server." };
  }

  const toResume = queue.current;
  const upcomingTracks = [...queue.tracks];
  const { voiceChannelId, textChannelId, volume, loop } = queue;
  const resumePositionMs = getResumePositionMs(queue, toResume);
  const previousNodeName: string | null =
    (queue.player as any)?.node?.name ?? (queue.player as any)?.options?.name ?? null;

  // Mark the existing queue stopped so its lingering events don't interfere,
  // then tear it down on Lavalink's side.
  queue.isStopped = true;
  try { await queue.player.stopTrack(); } catch { /* ignore */ }
  try { await shoukaku.leaveVoiceChannel(guildId); } catch { /* ignore */ }
  queues.delete(guildId);
  advanceDebounce.delete(guildId);

  // Tiny breather so Shoukaku finishes processing the disconnect before we rejoin.
  await new Promise<void>((r) => setTimeout(r, 750));

  const idealNode = shoukaku.getIdealNode();
  if (!idealNode) {
    return { ok: false, reason: "no-node", message: "no lavalink nodes are available right now." };
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
      resumePositionMs,
      autoplay: queue.autoplay,
      recentSeeds: [...queue.recentSeeds],
      recentlyPlayedUris: [...queue.recentlyPlayedUris],
      isFetchingAutoplay: false,
      isAdvancing: false,
      isStopped: false,
      recoveryAttempts: 0,
      recoveryWindowStartedAt: 0,
      isRecovering: false,
      lastTrackStartedAt: 0,
    };

    attachPlayerEvents(newPlayer, guildId);
    queues.set(guildId, newQueue);

    const newNodeName: string | null =
      (newPlayer as any)?.node?.name ?? (newPlayer as any)?.options?.name ?? idealNode.name ?? null;
    log(
      `[Music] Manual reconnect for guild ${guildId}: ${previousNodeName ?? "unknown"} -> ${newNodeName ?? "unknown"}` +
      `${toResume ? ` (resuming "${toResume.title}" at ${formatDuration(resumePositionMs)})` : ""}.`,
      "discord",
    );

    await advanceQueue(newPlayer, guildId);

    return {
      ok: true,
      resumedAt: resumePositionMs,
      trackTitle: toResume?.title ?? null,
      nodeName: newNodeName,
    };
  } catch (err: any) {
    log(`[Music] Manual reconnect failed for guild ${guildId}: ${err.message}`, "discord");
    return { ok: false, reason: "rejoin-failed", message: err.message };
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Radio bridge — exports used by server/radio.ts so Fred FM can borrow
// Lavalink to play random YouTube tracks alongside its local music_library.
// These helpers deliberately bypass the `queues` map so the music watchdogs
// (node-health, recovery, autoplay) ignore radio-owned players.
// ─────────────────────────────────────────────────────────────────────────────

export interface RadioYTTrack {
  encoded: string;
  title: string;
  author: string;
  uri: string;
  duration: number;
  artworkUrl: string | null;
}

export function isLavalinkAvailable(): boolean {
  if (!shoukaku) return false;
  try {
    return Boolean(shoukaku.getIdealNode());
  } catch {
    return false;
  }
}

export async function radioResolveYouTube(query: string, max = 8): Promise<RadioYTTrack[]> {
  if (!shoukaku) return [];
  const node = shoukaku.getIdealNode();
  if (!node) return [];

  const identifier = /^https?:\/\//i.test(query) ? query : `ytsearch:${query}`;

  try {
    const result = await node.rest.resolve(identifier);
    if (!result) return [];

    let raw: any[] = [];
    if (result.loadType === "search") {
      raw = (result.data as any[]) ?? [];
    } else if (result.loadType === "playlist") {
      raw = ((result.data as any).tracks ?? []) as any[];
    } else if (result.loadType === "track") {
      raw = [result.data as any];
    } else {
      return [];
    }

    const out: RadioYTTrack[] = [];
    for (const t of raw.slice(0, Math.max(1, max))) {
      if (!t?.encoded || !t.info) continue;
      if (t.info.isStream) continue;
      // Skip absurdly long uploads (likely mixes/concerts/full albums) — we want songs.
      const len = Number(t.info.length) || 0;
      if (len > 0 && len > 12 * 60_000) continue;
      out.push({
        encoded: t.encoded,
        title: String(t.info.title ?? "Unknown title"),
        author: String(t.info.author ?? "Unknown artist"),
        uri: String(t.info.uri ?? ""),
        duration: len,
        artworkUrl: t.info.artworkUrl ?? null,
      });
    }
    return out;
  } catch (err: any) {
    log(`[Music:radio] YT resolve failed for "${query}": ${err.message}`, "discord");
    return [];
  }
}

// Plays a single Lavalink track in a voice channel and resolves when the
// track ends (cleanly or otherwise). The caller MUST ensure no @discordjs/voice
// connection is active in this guild before calling this — otherwise the two
// libraries will fight over the voice gateway.
export async function radioPlayYouTubeBlocking(
  guildId: string,
  voiceChannelId: string,
  track: RadioYTTrack,
  shardId = 0,
  maxWaitMs = 12 * 60_000,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!shoukaku) return { ok: false, reason: "lavalink not initialised" };
  if (queues.has(guildId)) {
    return { ok: false, reason: "music queue already active in this guild" };
  }

  let player: Player | null = null;
  try {
    player = await shoukaku.joinVoiceChannel({
      guildId,
      channelId: voiceChannelId,
      shardId,
      deaf: true,
    });
  } catch (err: any) {
    return { ok: false, reason: `lavalink join failed: ${err.message}` };
  }

  // Strip any default listeners the framework attaches; we manage events
  // ourselves so the music watchdogs never see this player.
  try {
    player.removeAllListeners("start");
    player.removeAllListeners("end");
    player.removeAllListeners("exception");
    player.removeAllListeners("stuck");
    player.removeAllListeners("closed");
  } catch { /* ignore */ }

  const finished = new Promise<{ ok: true } | { ok: false; reason: string }>((resolve) => {
    let done = false;
    const finish = (result: { ok: true } | { ok: false; reason: string }) => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      resolve(result);
    };
    const safety = setTimeout(
      () => finish({ ok: false, reason: "watchdog timeout" }),
      Math.max(60_000, (track.duration || 0) + 30_000, maxWaitMs),
    );

    player!.on("end", (event: any) => {
      const reason = event?.reason as string | undefined;
      if (reason === "replaced" || reason === "cleanup") return;
      finish({ ok: true });
    });
    player!.on("exception", (event: any) => {
      const msg = event?.exception?.message ?? "unknown exception";
      finish({ ok: false, reason: msg });
    });
    player!.on("stuck", () => finish({ ok: false, reason: "track stuck" }));
    player!.on("closed", () => finish({ ok: false, reason: "voice connection closed" }));
  });

  try {
    await player.clearFilters();
  } catch { /* ignore */ }

  try {
    await player.playTrack({ track: { encoded: track.encoded } });
    await player.setGlobalVolume(100);
  } catch (err: any) {
    try { await shoukaku.leaveVoiceChannel(guildId); } catch { /* ignore */ }
    return { ok: false, reason: `lavalink playTrack failed: ${err.message}` };
  }

  const result = await finished;

  try { await player.stopTrack(); } catch { /* ignore */ }
  try { await shoukaku.leaveVoiceChannel(guildId); } catch { /* ignore */ }

  return result;
}

export async function radioLeaveVoiceChannel(guildId: string): Promise<void> {
  if (!shoukaku) return;
  if (queues.has(guildId)) return; // never disturb a real music queue
  try { await shoukaku.leaveVoiceChannel(guildId); } catch { /* ignore */ }
}
