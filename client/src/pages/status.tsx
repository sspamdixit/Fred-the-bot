import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Radio,
  Brain,
  Clock,
  Disc3,
  Wifi,
  WifiOff,
  RefreshCw,
  ListMusic,
  ChevronLeft,
} from "lucide-react";
import { DASHBOARD_AUTH_TOKEN_STORAGE_KEY } from "@/lib/queryClient";

const AUTH_FLAG_KEY = "fred-authed";
const REFETCH_MS = 15_000;

function isAuthed(): boolean {
  return (
    sessionStorage.getItem(AUTH_FLAG_KEY) === "1" &&
    !!sessionStorage.getItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY)
  );
}

interface RadioNowPlaying {
  title: string;
  artist: string;
  source: string;
  artworkUrl: string | null;
}

interface StationEntry {
  guildId: string;
  guildName: string;
  voiceChannelId: string;
  nowPlaying: RadioNowPlaying | null;
  mood: { mood: string; promptModifier: string } | null;
  songsSinceSelftalk: number;
}

interface RadioStatusData {
  stations: StationEntry[];
  lavalink: { available: boolean; nodeCount: number };
  playlist: {
    source: "spotify" | "youtube" | "genre_seeds";
    trackCount: number;
    ytPlaylistUrl: string | null;
  };
  updatedAt: number;
}

const MOOD_LABELS: Record<string, string> = {
  baseline: "baseline",
  caffeinated: "caffeinated",
  post_banger: "post-banger",
  philosophical: "philosophical",
  tired: "tired",
  entertained: "entertained",
  grumpy: "grumpy",
  warm: "warm",
  nostalgic: "nostalgic",
  distracted: "distracted",
  unimpressed: "unimpressed",
  genuinely_invested: "genuinely invested",
};

const MOOD_COLORS: Record<string, string> = {
  caffeinated: "rgb(250,204,21)",
  post_banger: "rgb(168,85,247)",
  philosophical: "rgb(125,211,252)",
  tired: "rgb(148,163,184)",
  entertained: "rgb(74,222,128)",
  grumpy: "rgb(248,113,113)",
  warm: "rgb(251,146,60)",
  nostalgic: "rgb(192,132,252)",
  distracted: "rgb(148,163,184)",
  unimpressed: "rgb(148,163,184)",
  genuinely_invested: "rgb(74,222,128)",
  baseline: "rgba(255,255,255,0.45)",
};

const SOURCE_LABELS: Record<string, string> = {
  spotify: "Spotify",
  youtube: "YouTube Playlist",
  genre_seeds: "Genre Seeds (no playlist)",
};

const SOURCE_COLORS: Record<string, string> = {
  spotify: "rgb(74,222,128)",
  youtube: "rgb(248,113,113)",
  genre_seeds: "rgba(255,255,255,0.5)",
};

export default function StatusPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthed()) setLocation("/");
  }, []);

  if (!isAuthed()) return null;
  return <StatusDashboard />;
}

function StatusDashboard() {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const h = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<RadioStatusData>({
    queryKey: ["/api/radio/status"],
    refetchInterval: visible ? REFETCH_MS : false,
  });

  const secondsSince = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / 1000)
    : null;

  void tick;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs hover:text-white transition-colors"
              style={{ color: "rgba(255,255,255,0.45)" }}
              data-testid="link-back-home"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              dashboard
            </Link>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <Radio className="w-5 h-5" style={{ color: "rgb(239,68,68)" }} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white leading-none" data-testid="text-status-title">
                Fred FM Status
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                {secondsSince !== null
                  ? secondsSince < 5
                    ? "updated just now"
                    : `updated ${secondsSince}s ago · refreshes every 15s`
                  : "loading…"}
              </p>
            </div>
          </div>

          <button
            className="aero-btn aero-btn-ghost aero-btn-sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {isLoading && (
          <div className="glass-panel p-10 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: "rgba(255,255,255,0.35)" }} />
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>fetching station data…</p>
          </div>
        )}

        {!isLoading && (
          <>
            {!data?.stations || data.stations.length === 0 ? (
              <div className="glass-panel p-10 flex flex-col items-center gap-3 text-center">
                <Radio className="w-9 h-9" style={{ color: "rgba(255,255,255,0.18)" }} />
                <p className="text-sm font-semibold text-white">fred fm is off the air</p>
                <p className="text-xs max-w-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  no active radio stations — use /radio in a server to start broadcasting
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.stations.map((s) => (
                  <StationCard key={s.guildId} station={s} />
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="glass-panel-sm px-5 py-4 space-y-3" data-testid="card-lavalink-health">
                <div className="flex items-center gap-2">
                  {data?.lavalink.available ? (
                    <Wifi className="w-4 h-4 flex-shrink-0" style={{ color: "rgb(74,222,128)" }} />
                  ) : (
                    <WifiOff className="w-4 h-4 flex-shrink-0" style={{ color: "rgb(248,113,113)" }} />
                  )}
                  <span className="text-sm font-semibold text-white">Lavalink</span>
                  <span
                    className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{
                      color: data?.lavalink.available ? "rgb(74,222,128)" : "rgb(248,113,113)",
                      background: data?.lavalink.available
                        ? "rgba(74,222,128,0.1)"
                        : "rgba(248,113,113,0.1)",
                      border: `1px solid ${data?.lavalink.available ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)"}`,
                    }}
                    data-testid="text-lavalink-status"
                  >
                    {data?.lavalink.available ? "OK" : "DOWN"}
                  </span>
                </div>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {data
                    ? `${data.lavalink.nodeCount} node${data.lavalink.nodeCount !== 1 ? "s" : ""} configured`
                    : "—"}
                </p>
              </div>

              <div className="glass-panel-sm px-5 py-4 space-y-3" data-testid="card-playlist-source">
                <div className="flex items-center gap-2">
                  <ListMusic className="w-4 h-4 flex-shrink-0" style={{ color: "rgba(125,211,252,0.9)" }} />
                  <span className="text-sm font-semibold text-white">Playlist Source</span>
                </div>
                <div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: data ? SOURCE_COLORS[data.playlist.source] : "rgba(255,255,255,0.5)" }}
                    data-testid="text-playlist-source"
                  >
                    {data ? (SOURCE_LABELS[data.playlist.source] ?? data.playlist.source) : "—"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                    {data?.playlist.trackCount
                      ? `${data.playlist.trackCount.toLocaleString()} tracks cached`
                      : "pulling from genre seeds each round"}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StationCard({ station }: { station: StationEntry }) {
  const moodName = station.mood?.mood ?? "baseline";
  const moodColor = MOOD_COLORS[moodName] ?? "rgba(255,255,255,0.45)";

  return (
    <div className="glass-panel overflow-hidden" data-testid={`card-station-${station.guildId}`}>
      <div
        className="px-5 py-3.5 flex items-center gap-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <Radio className="w-4 h-4 flex-shrink-0" style={{ color: "rgb(239,68,68)" }} />
        <h3 className="text-sm font-bold text-white truncate">{station.guildName}</h3>
        <span
          className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            color: "rgb(74,222,128)",
            background: "rgba(74,222,128,0.1)",
            border: "1px solid rgba(74,222,128,0.3)",
          }}
        >
          ON AIR
        </span>
      </div>

      <div className="p-5 flex gap-4">
        {station.nowPlaying?.artworkUrl ? (
          <img
            src={station.nowPlaying.artworkUrl}
            alt="album art"
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
            data-testid={`img-artwork-${station.guildId}`}
          />
        ) : (
          <div
            className="w-14 h-14 rounded-lg flex-shrink-0 flex items-center justify-center"
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
          >
            <Disc3 className="w-6 h-6" style={{ color: "rgba(239,68,68,0.45)" }} />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-3">
          {station.nowPlaying ? (
            <div>
              <p
                className="text-sm font-semibold text-white truncate"
                data-testid={`text-track-title-${station.guildId}`}
              >
                {station.nowPlaying.title}
              </p>
              <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.55)" }}>
                {station.nowPlaying.artist}
              </p>
              <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.28)" }}>
                via {station.nowPlaying.source}
              </p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.38)" }}>
              loading first track…
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
              style={{
                color: moodColor,
                background: `${moodColor}18`,
                border: `1px solid ${moodColor}40`,
              }}
              data-testid={`badge-mood-${station.guildId}`}
            >
              <Brain className="w-3 h-3 flex-shrink-0" />
              {MOOD_LABELS[moodName] ?? moodName}
            </span>

          </div>
        </div>
      </div>
    </div>
  );
}
