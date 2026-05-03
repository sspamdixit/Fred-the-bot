import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Disc3,
  Wifi,
  WifiOff,
  RefreshCw,
  ChevronLeft,
  Music2,
  Clock,
  ListMusic,
} from "lucide-react";
import { DASHBOARD_AUTH_TOKEN_STORAGE_KEY } from "@/lib/queryClient";

const AUTH_FLAG_KEY = "fred-authed";
const REFETCH_MS = 5_000;

function isAuthed(): boolean {
  return (
    sessionStorage.getItem(AUTH_FLAG_KEY) === "1" &&
    !!sessionStorage.getItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY)
  );
}

interface DjTrackInfo {
  title: string;
  author: string;
  artworkUrl: string | null;
  duration: number;
  position: number;
}

interface DjSession {
  guildId: string;
  genre: string;
  currentTrack: DjTrackInfo | null;
  queueLength: number;
}

interface DjStatusData {
  sessions: DjSession[];
  lavalink: { available: boolean; nodeCount: number };
  updatedAt: number;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

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
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<DjStatusData>({
    queryKey: ["/api/dj/status"],
    refetchInterval: visible ? REFETCH_MS : false,
  });

  const secondsSince = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / 1000)
    : null;

  void tick;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">

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

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(125,211,252,0.12)", border: "1px solid rgba(125,211,252,0.3)" }}
            >
              <Music2 className="w-5 h-5" style={{ color: "rgb(125,211,252)" }} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white leading-none" data-testid="text-status-title">
                Rave Status
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                {secondsSince !== null
                  ? secondsSince < 5
                    ? "updated just now"
                    : `updated ${secondsSince}s ago`
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
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>loading…</p>
          </div>
        )}

        {!isLoading && (
          <>
            {!data?.sessions || data.sessions.length === 0 ? (
              <div className="glass-panel p-10 flex flex-col items-center gap-3 text-center">
                <Disc3 className="w-9 h-9" style={{ color: "rgba(255,255,255,0.18)" }} />
                <p className="text-sm font-semibold text-white">no active rave sessions</p>
                <p className="text-xs max-w-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  use /rave &lt;genre&gt; in a server to start
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.sessions.map((s) => (
                  <DjSessionCard key={s.guildId} session={s} />
                ))}
              </div>
            )}

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
                    background: data?.lavalink.available ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
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
          </>
        )}
      </div>
    </div>
  );
}

function DjSessionCard({ session: s }: { session: DjSession }) {
  const t = s.currentTrack;

  const progressPct = t && t.duration > 0
    ? Math.min(100, (t.position / t.duration) * 100)
    : 0;

  return (
    <div
      className="glass-panel px-5 py-4 space-y-3"
      data-testid={`card-dj-${s.guildId}`}
    >
      <div className="flex items-center gap-4">
        {t?.artworkUrl ? (
          <img
            src={t.artworkUrl}
            alt="artwork"
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(125,211,252,0.1)", border: "1px solid rgba(125,211,252,0.25)" }}
          >
            <Music2 className="w-5 h-5" style={{ color: "rgb(125,211,252)" }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white truncate" data-testid={`text-dj-genre-${s.guildId}`}>
              {t ? t.title : s.genre}
            </p>
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
              style={{
                color: "rgb(74,222,128)",
                background: "rgba(74,222,128,0.1)",
                border: "1px solid rgba(74,222,128,0.3)",
              }}
            >
              LIVE
            </span>
          </div>
          {t ? (
            <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>
              {t.author} · {s.genre}
            </p>
          ) : (
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
              guild {s.guildId}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {s.queueLength > 0 && (
            <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              <ListMusic className="w-3.5 h-3.5" />
              <span className="text-xs">{s.queueLength}</span>
            </div>
          )}
          {t && (
            <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              <Clock className="w-3.5 h-3.5" />
              <span className="text-xs" data-testid={`text-dj-position-${s.guildId}`}>
                {formatMs(t.position)} / {formatMs(t.duration)}
              </span>
            </div>
          )}
        </div>
      </div>

      {t && t.duration > 0 && (
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: "3px", background: "rgba(255,255,255,0.1)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${progressPct}%`,
              background: "rgb(125,211,252)",
            }}
          />
        </div>
      )}
    </div>
  );
}
