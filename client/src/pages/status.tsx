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

interface DjSession {
  guildId: string;
  genre: string;
}

interface DjStatusData {
  sessions: DjSession[];
  lavalink: { available: boolean; nodeCount: number };
  updatedAt: number;
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
    const t = setInterval(() => setTick((n) => n + 1), 5_000);
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
                DJ Status
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
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>loading…</p>
          </div>
        )}

        {!isLoading && (
          <>
            {!data?.sessions || data.sessions.length === 0 ? (
              <div className="glass-panel p-10 flex flex-col items-center gap-3 text-center">
                <Disc3 className="w-9 h-9" style={{ color: "rgba(255,255,255,0.18)" }} />
                <p className="text-sm font-semibold text-white">no active dj sessions</p>
                <p className="text-xs max-w-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  use /dj &lt;genre&gt; in a server to start
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.sessions.map((s) => (
                  <div
                    key={s.guildId}
                    className="glass-panel px-5 py-4 flex items-center gap-4"
                    data-testid={`card-dj-${s.guildId}`}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(125,211,252,0.1)", border: "1px solid rgba(125,211,252,0.25)" }}
                    >
                      <Music2 className="w-5 h-5" style={{ color: "rgb(125,211,252)" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate" data-testid={`text-dj-genre-${s.guildId}`}>
                        {s.genre}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                        guild {s.guildId}
                      </p>
                    </div>
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{
                        color: "rgb(74,222,128)",
                        background: "rgba(74,222,128,0.1)",
                        border: "1px solid rgba(74,222,128,0.3)",
                      }}
                    >
                      LIVE
                    </span>
                  </div>
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
