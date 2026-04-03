import { useState, useEffect, useRef, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiDiscord } from "react-icons/si";
import { Switch } from "@/components/ui/switch";
import {
  Server,
  Clock,
  Activity,
  Eye,
  Wifi,
  WifiOff,
  AlertCircle,
  RefreshCw,
  Send,
  Hash,
  CheckCircle2,
  Megaphone,
  Zap,
  Lock,
  Bot,
  KeyRound,
  MessageSquare,
  CalendarClock,
  ShieldCheck,
  Play,
  FlaskConical,
  XCircle,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
} from "lucide-react";
import {
  apiRequest,
  DASHBOARD_AUTH_TOKEN_STORAGE_KEY,
  DASHBOARD_AUTH_CHANGED_EVENT,
} from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DASHBOARD_AUTH_FLAG_STORAGE_KEY = "bubbl-authed";

function hasDashboardSession(): boolean {
  return (
    sessionStorage.getItem(DASHBOARD_AUTH_FLAG_STORAGE_KEY) === "1" &&
    !!sessionStorage.getItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY)
  );
}

interface BotStatus {
  online: boolean;
  tag: string | null;
  avatarUrl: string | null;
  guildCount: number;
  uptimeStart: number | null;
  status: string;
  activityName: string;
  activityType: string;
  lastError: string | null;
}

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  channels: ChannelInfo[];
}

const STATUS_OPTIONS = [
  { value: "online",    label: "Online",         color: "bg-status-online" },
  { value: "idle",      label: "Idle",           color: "bg-status-away" },
  { value: "dnd",       label: "Do Not Disturb", color: "bg-status-busy" },
  { value: "invisible", label: "Invisible",      color: "bg-status-offline" },
] as const;

const ACTIVITY_TYPES = ["Playing", "Watching", "Listening", "Competing", "Streaming", "Custom"] as const;

type AiProviderKind = "gemini" | "groq" | "hackclub";

interface AiProviderRowApi {
  id: number;
  sortOrder: number;
  provider: AiProviderKind;
  model: string | null;
  enabled: boolean;
  keyHint: string | null;
  keySource: "db" | "env" | "none";
}

interface AiProviderDraft {
  /** Stable key for React list (reorder-safe). */
  localId: string;
  id?: number;
  provider: AiProviderKind;
  model: string;
  enabled: boolean;
  newKey: string;
  clearStoredKey: boolean;
}

const PROVIDER_LABEL: Record<AiProviderKind, string> = {
  gemini: "Gemini (Google)",
  groq: "Groq",
  hackclub: "Hack Club (Grok)",
};

const MODEL_PLACEHOLDER: Record<AiProviderKind, string> = {
  gemini: "default: tries flash models in order",
  groq: "default: llama-3.3-70b-versatile",
  hackclub: "default: x-ai/grok-4.1-fast",
};

function formatUptime(uptimeStart: number | null): string {
  if (!uptimeStart) return "—";
  const ms = Date.now() - uptimeStart;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);
  if (days    > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours   > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function StatusDot({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const sizeClass = size === "md" ? "w-3 h-3" : "w-2.5 h-2.5";
  const colorMap: Record<string, string> = {
    online:    "bg-status-online pulse-dot",
    idle:      "bg-status-away",
    dnd:       "bg-status-busy pulse-dot-error",
    invisible: "bg-status-offline",
    error:     "bg-status-busy pulse-dot-error",
    offline:   "bg-status-offline",
  };
  return (
    <span
      data-testid={`status-dot-${status}`}
      className={`inline-block ${sizeClass} rounded-full flex-shrink-0 ${colorMap[status] ?? "bg-status-offline"}`}
    />
  );
}

function PasswordScreen({ onAuth }: { onAuth: () => void }) {
  const [pw, setPw]         = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (!data?.token || typeof data.token !== "string") {
          setError("Invalid auth response. Try again.");
          return;
        }
        sessionStorage.setItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY, data.token);
        sessionStorage.setItem("bubbl-authed", "1");
        onAuth();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Incorrect password.");
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="bubble" style={{ width: 420, height: 420, top: -120, right: -100, animationDuration: "14s" }} />
      <div className="bubble" style={{ width: 280, height: 280, bottom: -60, left: -80,  animationDuration: "10s", animationDelay: "2s" }} />
      <div className="bubble" style={{ width: 160, height: 160, top: "40%", left: "15%", animationDuration: "9s",  animationDelay: "1s" }} />

      <div className="glass-panel w-full max-w-sm p-8 space-y-7 relative z-10">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{
              background: "linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(56,189,248,0.45) 100%)",
              border: "1px solid rgba(255,255,255,0.4)",
              boxShadow: "0 4px 20px rgba(56,189,248,0.3), inset 0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            <SiDiscord className="w-7 h-7 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight">Bubbl Manager</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>
              Enter your password to continue
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw-input" className="text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.55)" }}>
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              <Input
                id="pw-input"
                data-testid="input-password"
                type="password"
                placeholder="••••••••"
                value={pw}
                onChange={(e) => { setPw(e.target.value); setError(""); }}
                autoFocus
                className="aero-input pl-9 h-10"
              />
            </div>
            {error && (
              <p className="text-xs flex items-center gap-1.5" style={{ color: "rgb(248,113,113)" }} data-testid="text-pw-error">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="aero-btn w-full justify-center h-10"
            disabled={loading || pw.length === 0}
            data-testid="button-login"
          >
            {loading
              ? <><RefreshCw className="w-4 h-4 animate-spin" />Verifying…</>
              : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const [authed, setAuthed] = useState(() => hasDashboardSession());

  useEffect(() => {
    const syncAuth = () => {
      setAuthed((previous) => {
        const next = hasDashboardSession();
        return previous === next ? previous : next;
      });
    };

    window.addEventListener(DASHBOARD_AUTH_CHANGED_EVENT, syncAuth);
    window.addEventListener("focus", syncAuth);
    document.addEventListener("visibilitychange", syncAuth);

    return () => {
      window.removeEventListener(DASHBOARD_AUTH_CHANGED_EVENT, syncAuth);
      window.removeEventListener("focus", syncAuth);
      document.removeEventListener("visibilitychange", syncAuth);
    };
  }, []);

  if (!authed) return <PasswordScreen onAuth={() => setAuthed(true)} />;
  return <Dashboard />;
}

function GlassSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-lg animate-pulse ${className ?? ""}`}
      style={{ background: "rgba(255,255,255,0.12)" }}
    />
  );
}

function Panel({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-6 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <Icon className="w-4 h-4" style={{ color: "rgba(125,211,252,0.9)" }} />
        <h3 className="text-sm font-bold tracking-wide text-white">{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function StatCard({ label, icon: Icon, children }: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel-sm px-5 py-4 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
        <Icon className="w-4 h-4" style={{ color: "rgba(255,255,255,0.35)" }} />
      </div>
      <div>{children}</div>
    </div>
  );
}

function AeroLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold tracking-wider uppercase mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
      {children}
    </label>
  );
}

function Dashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedGuildId,   setSelectedGuildId]   = useState<string>("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [message,           setMessage]           = useState<string>("");
  const [lastSent,          setLastSent]           = useState<{ channel: string; guild: string } | null>(null);

  const [presenceStatus, setPresenceStatus] = useState<string>("online");
  const [activityType,   setActivityType]   = useState<string>("Watching");
  const [activityName,   setActivityName]   = useState<string>("the Archives");
  const [presenceSaved,  setPresenceSaved]  = useState(false);

  const { data: aiProvidersData, isLoading: aiLoading } = useQuery<{ providers: AiProviderRowApi[] }>({
    queryKey: ["/api/ai/providers"],
    refetchInterval: false,
  });

  const [aiDraft, setAiDraft] = useState<AiProviderDraft[] | null>(null);

  useEffect(() => {
    if (!aiProvidersData?.providers) return;
    setAiDraft(
      aiProvidersData.providers.map((p) => ({
        localId: `s-${p.id}`,
        id: p.id,
        provider: p.provider,
        model: p.model ?? "",
        enabled: p.enabled,
        newKey: "",
        clearStoredKey: false,
      })),
    );
  }, [aiProvidersData]);

  const aiSaveMutation = useMutation({
    mutationFn: async () => {
      if (!aiDraft?.length) throw new Error("Nothing to save.");
      const body = {
        providers: aiDraft.map(({ localId: _lid, ...r }) => ({
          id: r.id,
          provider: r.provider,
          model: r.model.trim() || null,
          enabled: r.enabled,
          ...(r.clearStoredKey ? { apiKey: "" } : r.newKey.trim() ? { apiKey: r.newKey.trim() } : {}),
        })),
      };
      const res = await apiRequest("PUT", "/api/ai/providers", body);
      return res.json() as Promise<{ providers: AiProviderRowApi[] }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/status"] });
      toast({ title: "AI settings saved", description: "Provider order and keys updated." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message ?? "Something went wrong.", variant: "destructive" });
    },
  });

  const { data: status, isLoading: statusLoading, isError, refetch, isFetching } = useQuery<BotStatus>({
    queryKey: ["/api/bot/status"],
    refetchInterval: 5000,
  });

  const { data: guilds = [], isLoading: guildsLoading } = useQuery<GuildInfo[]>({
    queryKey: ["/api/bot/guilds"],
    refetchInterval: 30000,
    enabled: status?.online === true,
  });

  useEffect(() => {
    if (status && !presenceSaved) {
      setPresenceStatus(status.status === "error" || status.status === "offline" ? "online" : status.status);
      setActivityType(status.activityType);
      setActivityName(status.activityName);
    }
  }, [status?.status, status?.activityType, status?.activityName]);

  const selectedGuild   = guilds.find((g) => g.id === selectedGuildId);
  const selectedChannel = selectedGuild?.channels.find((c) => c.id === selectedChannelId);

  useEffect(() => {
    if (guilds.length > 0 && !selectedGuildId) setSelectedGuildId(guilds[0].id);
  }, [guilds]);

  useEffect(() => {
    if (selectedGuild && selectedGuild.channels.length > 0) {
      setSelectedChannelId(selectedGuild.channels[0].id);
    } else {
      setSelectedChannelId("");
    }
  }, [selectedGuildId]);

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot/send", { channelId: selectedChannelId, content: message }),
    onSuccess: () => {
      setLastSent({ channel: selectedChannel?.name ?? selectedChannelId, guild: selectedGuild?.name ?? selectedGuildId });
      setMessage("");
      toast({ title: "Message sent", description: `Posted to #${selectedChannel?.name} in ${selectedGuild?.name}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send", description: err?.message ?? "Something went wrong.", variant: "destructive" });
    },
  });

  const presenceMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/bot/presence", { status: presenceStatus, activityType, activityName }),
    onSuccess: () => {
      setPresenceSaved(true);
      qc.invalidateQueries({ queryKey: ["/api/bot/status"] });
      toast({ title: "Presence updated", description: `Now showing as ${presenceStatus}` });
      setTimeout(() => setPresenceSaved(false), 3000);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update presence", description: err?.message ?? "Something went wrong.", variant: "destructive" });
    },
  });

  const [testHistory, setTestHistory] = useState<Array<{ role: "user" | "bot"; text: string }>>([]);
  const [testInput, setTestInput] = useState("");
  const testScrollRef = useRef<HTMLDivElement>(null);

  const { data: qotdStatus } = useQuery<{
    last: { type: string; question: string; optionA?: string; optionB?: string; sentAt: string } | null;
    nextType: string;
    nextAt: string;
  }>({ queryKey: ["/api/qotd/status"], refetchInterval: 60_000 });

  const { data: serviceHealth } = useQuery<{
    processStartTime: number;
    keepAliveEnabled: boolean;
    renderUrl: string | null;
  }>({ queryKey: ["/api/service/health"], refetchInterval: 30_000 });

  const qotdTriggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/qotd/trigger", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/qotd/status"] });
      toast({ title: "QOTD sent!", description: "Check #qotd in Discord." });
    },
    onError: (err: any) => {
      toast({ title: "QOTD failed", description: err?.message ?? "Something went wrong.", variant: "destructive" });
    },
  });

  const aiTestMutation = useMutation({
    mutationFn: async (msg: string) => {
      const res = await apiRequest("POST", "/api/ai/test", { message: msg });
      return res.json() as Promise<{ reply: string }>;
    },
    onSuccess: (data, msg) => {
      setTestHistory((prev) => [...prev, { role: "user", text: msg }, { role: "bot", text: data.reply }]);
      setTestInput("");
      setTimeout(() => {
        testScrollRef.current?.scrollTo({ top: testScrollRef.current.scrollHeight, behavior: "smooth" });
      }, 50);
    },
    onError: (err: any) => {
      toast({ title: "AI test failed", description: err?.message ?? "Something went wrong.", variant: "destructive" });
    },
  });

  const canSend           = status?.online && selectedChannelId && message.trim().length > 0 && !sendMutation.isPending;
  const canUpdatePresence = status?.online && !presenceMutation.isPending;

  const statusLabel = status?.status === "online" ? "Online"
    : status?.status === "idle" ? "Idle"
    : status?.status === "dnd"  ? "DND"
    : status?.status === "error" ? "Error"
    : "Offline";

  const statusTextColor = status?.status === "online" ? "rgb(74,222,128)"
    : status?.status === "idle"  ? "rgb(250,204,21)"
    : status?.status === "dnd"   ? "rgb(248,113,113)"
    : status?.status === "error" ? "rgb(248,113,113)"
    : "rgb(148,163,184)";

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="bubble" style={{ width: 520, height: 520, top: -160, right: -130, animationDuration: "15s" }} />
      <div className="bubble" style={{ width: 300, height: 300, top: 350,  left: -90,  animationDuration: "11s", animationDelay: "2.5s" }} />
      <div className="bubble" style={{ width: 200, height: 200, bottom: 200, right: 220, animationDuration: "13s", animationDelay: "1s" }} />
      <div className="bubble" style={{ width: 130, height: 130, top: 220,  left: 320,  animationDuration: "9s",  animationDelay: "3.5s" }} />
      <div className="bubble" style={{ width: 80,  height: 80,  bottom: 100, left: 180, animationDuration: "8s",  animationDelay: "0.5s" }} />

      <div className="relative z-10 max-w-4xl mx-auto px-5 py-10 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(56,189,248,0.45) 100%)",
                border: "1px solid rgba(255,255,255,0.38)",
                boxShadow: "0 4px 16px rgba(56,189,248,0.3), inset 0 1px 0 rgba(255,255,255,0.5)",
              }}
            >
              <SiDiscord className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white leading-none" data-testid="text-title">Bubbl Manager</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Bot Control Panel</p>
            </div>
          </div>

          <button
            className="aero-btn aero-btn-ghost aero-btn-sm"
            onClick={() => {
              refetch();
              qc.invalidateQueries({ queryKey: ["/api/ai/providers"] });
            }}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="glass-panel p-6">
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative flex-shrink-0">
              {statusLoading ? (
                <GlassSkeleton className="w-20 h-20 rounded-full" />
              ) : status?.avatarUrl ? (
                <img
                  src={status.avatarUrl}
                  alt="Bot avatar"
                  data-testid="img-avatar"
                  className="w-20 h-20 rounded-full object-cover"
                  style={{ border: "2px solid rgba(255,255,255,0.35)", boxShadow: "0 0 0 2px rgba(56,189,248,0.4), 0 4px 16px rgba(0,0,0,0.25)" }}
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.1)", border: "2px solid rgba(255,255,255,0.2)" }}
                >
                  <SiDiscord className="w-9 h-9" style={{ color: "rgba(255,255,255,0.4)" }} />
                </div>
              )}
              <div
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: "rgba(10,70,100,0.9)", border: "2px solid rgba(255,255,255,0.25)" }}
              >
                {!statusLoading && <StatusDot status={status?.status ?? "offline"} size="md" />}
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-1.5">
              {statusLoading ? (
                <><GlassSkeleton className="h-6 w-48" /><GlassSkeleton className="h-4 w-32 mt-2" /></>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-white truncate" data-testid="text-bot-tag">
                      {status?.tag ?? "Not connected"}
                    </h2>
                    <span
                      data-testid="badge-status"
                      className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                      style={{
                        background: "rgba(255,255,255,0.12)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: statusTextColor,
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                    <Eye className="w-3.5 h-3.5 flex-shrink-0" />
                    <span data-testid="text-activity">
                      {status?.online ? `${status.activityType} ${status.activityName}` : "No activity"}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex-shrink-0">
              {statusLoading ? (
                <GlassSkeleton className="w-10 h-10 rounded-xl" />
              ) : (
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: status?.online
                      ? "rgba(74,222,128,0.15)"
                      : "rgba(148,163,184,0.1)",
                    border: "1px solid " + (status?.online ? "rgba(74,222,128,0.3)" : "rgba(148,163,184,0.2)"),
                  }}
                >
                  {status?.online
                    ? <Wifi className="w-5 h-5" style={{ color: "rgb(74,222,128)" }} />
                    : <WifiOff className="w-5 h-5" style={{ color: "rgb(148,163,184)" }} />}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Status" icon={Activity}>
            {statusLoading ? <GlassSkeleton className="h-8 w-24" /> : (
              <div className="flex items-center gap-2 mt-1">
                <StatusDot status={status?.status ?? "offline"} size="md" />
                <span className="text-2xl font-extrabold" style={{ color: statusTextColor }} data-testid="text-status-value">
                  {statusLabel}
                </span>
              </div>
            )}
          </StatCard>

          <StatCard label="Servers" icon={Server}>
            {statusLoading ? <GlassSkeleton className="h-8 w-16" /> : (
              <span className="text-2xl font-extrabold text-white" data-testid="text-guild-count">
                {status?.guildCount ?? 0}
              </span>
            )}
          </StatCard>

          <StatCard label="Uptime" icon={Clock}>
            {statusLoading ? <GlassSkeleton className="h-8 w-28" /> : (
              <span className="text-2xl font-extrabold text-white" data-testid="text-uptime">
                {formatUptime(status?.uptimeStart ?? null)}
              </span>
            )}
          </StatCard>
        </div>

        <Panel title="Bot Presence" icon={Zap}>
          {!status?.online && !statusLoading ? (
            <div
              className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}
            >
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              <span>Bot must be online to change presence.</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <AeroLabel htmlFor="select-presence-status">Status</AeroLabel>
                  <Select value={presenceStatus} onValueChange={setPresenceStatus} disabled={!status?.online}>
                    <SelectTrigger
                      data-testid="select-presence-status"
                      id="select-presence-status"
                      className="aero-select-trigger w-full h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} data-testid={`option-status-${opt.value}`}>
                          <div className="flex items-center gap-2">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${opt.color}`} />
                            <span>{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <AeroLabel htmlFor="select-activity-type">Activity Type</AeroLabel>
                  <Select value={activityType} onValueChange={setActivityType} disabled={!status?.online}>
                    <SelectTrigger
                      data-testid="select-activity-type"
                      id="select-activity-type"
                      className="aero-select-trigger w-full h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPES.map((t) => (
                        <SelectItem key={t} value={t} data-testid={`option-activity-${t}`}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <AeroLabel htmlFor="input-activity-name">Activity Text</AeroLabel>
                  <Input
                    id="input-activity-name"
                    data-testid="input-activity-name"
                    value={activityName}
                    onChange={(e) => setActivityName(e.target.value.slice(0, 128))}
                    placeholder="e.g. the Archives"
                    disabled={!status?.online}
                    className="aero-input h-10"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
                <div className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                  <StatusDot status={presenceStatus} />
                  <span>
                    Preview:{" "}
                    <span className="text-white font-semibold">
                      {activityName.trim() ? `${activityType} ${activityName}` : "No activity"}
                    </span>
                  </span>
                </div>

                <button
                  data-testid="button-apply-presence"
                  className="aero-btn"
                  onClick={() => presenceMutation.mutate()}
                  disabled={!canUpdatePresence}
                >
                  {presenceMutation.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Applying…</>
                  ) : presenceSaved ? (
                    <><CheckCircle2 className="w-4 h-4" style={{ color: "rgb(74,222,128)" }} />Applied!</>
                  ) : (
                    <><Zap className="w-4 h-4" />Apply Presence</>
                  )}
                </button>
              </div>
            </>
          )}
        </Panel>

        <Panel title="AI Responses" icon={Bot}>
          <div className="space-y-4">
            <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              Providers are tried from top to bottom. The same system instructions (persona + safety rules) apply to every model.
              Keys are stored in the database. Leave the key field blank when saving to keep the current key; use &quot;Use env only&quot; to clear a stored key and use the server environment variable instead.
            </p>

            {aiLoading || !aiDraft ? (
              <GlassSkeleton className="h-48 w-full rounded-xl" />
            ) : (
              <>
                {aiDraft.map((row, idx) => {
                  const serverRow = aiProvidersData?.providers.find((p) => p.id === row.id);
                  const keyOk = serverRow && (serverRow.keySource !== "none" || row.newKey.trim().length > 0);
                  const keyColor = keyOk ? "rgb(74,222,128)" : "rgb(248,113,113)";
                  return (
                    <div
                      key={row.localId}
                      className="rounded-xl p-4 space-y-3"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            className="aero-btn aero-btn-ghost aero-btn-sm px-2 py-1"
                            disabled={idx === 0 || aiSaveMutation.isPending}
                            aria-label="Move up"
                            onClick={() => {
                              setAiDraft((d) => {
                                if (!d || idx === 0) return d;
                                const next = [...d];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                return next;
                              });
                            }}
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="aero-btn aero-btn-ghost aero-btn-sm px-2 py-1"
                            disabled={idx >= aiDraft.length - 1 || aiSaveMutation.isPending}
                            aria-label="Move down"
                            onClick={() => {
                              setAiDraft((d) => {
                                if (!d || idx >= d.length - 1) return d;
                                const next = [...d];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                return next;
                              });
                            }}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex-1 min-w-[200px] space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span
                              className="text-xs font-bold uppercase tracking-wider"
                              style={{ color: "rgba(255,255,255,0.45)" }}
                            >
                              #{idx + 1}
                            </span>
                            <Select
                              value={row.provider}
                              onValueChange={(v) => {
                                const pv = v as AiProviderKind;
                                setAiDraft((d) => {
                                  if (!d) return d;
                                  const next = [...d];
                                  next[idx] = { ...next[idx], provider: pv };
                                  return next;
                                });
                              }}
                              disabled={aiSaveMutation.isPending}
                            >
                              <SelectTrigger className="aero-select-trigger w-[220px] h-9" data-testid={`select-ai-provider-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="gemini">{PROVIDER_LABEL.gemini}</SelectItem>
                                <SelectItem value="groq">{PROVIDER_LABEL.groq}</SelectItem>
                                <SelectItem value="hackclub">{PROVIDER_LABEL.hackclub}</SelectItem>
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-2">
                              <span className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>On</span>
                              <Switch
                                checked={row.enabled}
                                disabled={aiSaveMutation.isPending}
                                onCheckedChange={(checked) => {
                                  setAiDraft((d) => {
                                    if (!d) return d;
                                    const next = [...d];
                                    next[idx] = { ...next[idx], enabled: checked };
                                    return next;
                                  });
                                }}
                                data-testid={`switch-ai-enabled-${idx}`}
                              />
                            </div>
                          </div>

                          <div>
                            <AeroLabel htmlFor={`ai-model-${idx}`}>Model override</AeroLabel>
                            <Input
                              id={`ai-model-${idx}`}
                              className="aero-input h-9"
                              placeholder={MODEL_PLACEHOLDER[row.provider]}
                              value={row.model}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAiDraft((d) => {
                                  if (!d) return d;
                                  const next = [...d];
                                  next[idx] = { ...next[idx], model: v };
                                  return next;
                                });
                              }}
                              disabled={aiSaveMutation.isPending}
                            />
                          </div>

                          <div>
                            <AeroLabel htmlFor={`ai-key-${idx}`}>API key</AeroLabel>
                            <Input
                              id={`ai-key-${idx}`}
                              type="password"
                              className="aero-input h-9"
                              placeholder="Leave blank to keep current key"
                              value={row.newKey}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAiDraft((d) => {
                                  if (!d) return d;
                                  const next = [...d];
                                  next[idx] = { ...next[idx], newKey: v, clearStoredKey: false };
                                  return next;
                                });
                              }}
                              disabled={aiSaveMutation.isPending}
                              autoComplete="off"
                            />
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              {serverRow?.keySource === "db" && (
                                <button
                                  type="button"
                                  className="text-xs underline underline-offset-2"
                                  style={{ color: "rgba(125,211,252,0.9)" }}
                                  onClick={() => {
                                    setAiDraft((d) => {
                                      if (!d) return d;
                                      const next = [...d];
                                      next[idx] = { ...next[idx], newKey: "", clearStoredKey: true };
                                      return next;
                                    });
                                  }}
                                >
                                  Use env only (clear stored key)
                                </button>
                              )}
                              {row.clearStoredKey && (
                                <span className="text-xs" style={{ color: "rgb(250,204,21)" }}>
                                  Will clear stored key on save
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                            <KeyRound className="w-3.5 h-3.5 flex-shrink-0" style={{ color: keyColor }} />
                            <span>
                              Active key:{" "}
                              <span className="font-semibold" style={{ color: keyColor }}>
                                {serverRow?.keyHint ?? "—"}
                                {serverRow?.keySource === "env" && !row.newKey && !row.clearStoredKey && " (environment)"}
                              </span>
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="aero-btn aero-btn-ghost aero-btn-sm px-2 py-2 text-red-300"
                          disabled={aiDraft.length <= 1 || aiSaveMutation.isPending}
                          aria-label="Remove provider"
                          onClick={() => {
                            setAiDraft((d) => (d ? d.filter((_, i) => i !== idx) : d));
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="aero-btn aero-btn-ghost aero-btn-sm"
                    disabled={aiSaveMutation.isPending}
                    onClick={() => {
                      setAiDraft((d) => [
                        ...(d ?? []),
                        {
                          localId: `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                          provider: "groq",
                          model: "",
                          enabled: true,
                          newKey: "",
                          clearStoredKey: false,
                        },
                      ]);
                    }}
                  >
                    <Plus className="w-4 h-4" />
                    Add provider
                  </button>
                  <button
                    type="button"
                    className="aero-btn"
                    disabled={aiSaveMutation.isPending || !aiDraft.length}
                    data-testid="button-save-ai-providers"
                    onClick={() => aiSaveMutation.mutate()}
                  >
                    {aiSaveMutation.isPending ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" />Saving…</>
                    ) : (
                      <><ShieldCheck className="w-4 h-4" />Save AI settings</>
                    )}
                  </button>
                </div>
              </>
            )}

            {aiProvidersData?.providers?.length && aiProvidersData.providers.every(
              (p) => !p.enabled || p.keySource === "none",
            ) && (
              <div
                className="flex items-start gap-2 px-4 py-3 rounded-xl text-sm"
                style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)" }}
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "rgb(248,113,113)" }} />
                <span style={{ color: "rgba(255,255,255,0.65)" }}>
                  No usable AI provider (every step is off or has no key). The bot will not reply to mentions until you add keys or enable a step with an environment key.
                </span>
              </div>
            )}
          </div>
        </Panel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        <Panel title="Send a Message" icon={Send}>
          {!status?.online && !statusLoading ? (
            <div
              className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}
            >
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              <span>Bot must be online to send messages.</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <AeroLabel htmlFor="select-server">Server</AeroLabel>
                  {guildsLoading ? <GlassSkeleton className="h-10 w-full rounded-xl" /> : (
                    <Select value={selectedGuildId} onValueChange={setSelectedGuildId}>
                      <SelectTrigger data-testid="select-server" id="select-server" className="aero-select-trigger w-full h-10">
                        <SelectValue placeholder="Select a server…" />
                      </SelectTrigger>
                      <SelectContent>
                        {guilds.length === 0 ? (
                          <SelectItem value="__none" disabled>No servers found</SelectItem>
                        ) : guilds.map((g) => (
                          <SelectItem key={g.id} value={g.id} data-testid={`option-server-${g.id}`}>
                            <div className="flex items-center gap-2">
                              {g.iconUrl ? (
                                <img src={g.iconUrl} alt={g.name} className="w-4 h-4 rounded-full object-cover" />
                              ) : (
                                <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center">
                                  <SiDiscord className="w-2.5 h-2.5 text-muted-foreground" />
                                </div>
                              )}
                              <span>{g.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div>
                  <AeroLabel htmlFor="select-channel">Channel</AeroLabel>
                  {guildsLoading ? <GlassSkeleton className="h-10 w-full rounded-xl" /> : (
                    <Select
                      value={selectedChannelId}
                      onValueChange={setSelectedChannelId}
                      disabled={!selectedGuildId || (selectedGuild?.channels.length ?? 0) === 0}
                    >
                      <SelectTrigger data-testid="select-channel" id="select-channel" className="aero-select-trigger w-full h-10">
                        <SelectValue placeholder="Select a channel…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedGuild?.channels ?? []).length === 0 ? (
                          <SelectItem value="__none" disabled>No text channels</SelectItem>
                        ) : (selectedGuild?.channels ?? []).map((ch) => (
                          <SelectItem key={ch.id} value={ch.id} data-testid={`option-channel-${ch.id}`}>
                            <div className="flex items-center gap-2">
                              {ch.type === "announcement"
                                ? <Megaphone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                : <Hash className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                              <span>{ch.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <AeroLabel htmlFor="input-message">Message</AeroLabel>
                  <span
                    className="text-xs font-medium"
                    style={{ color: message.length > 1900 ? "rgb(248,113,113)" : "rgba(255,255,255,0.4)" }}
                  >
                    {message.length}/2000
                  </span>
                </div>
                <Textarea
                  id="input-message"
                  data-testid="input-message"
                  placeholder={selectedChannelId ? `Message #${selectedChannel?.name ?? "channel"}` : "Select a channel first…"}
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                  disabled={!selectedChannelId}
                  rows={4}
                  className="aero-input resize-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                {lastSent ? (
                  <div className="flex items-center gap-1.5 text-xs" style={{ color: "rgb(74,222,128)" }}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span data-testid="text-last-sent">Sent to #{lastSent.channel} in {lastSent.guild}</span>
                  </div>
                ) : <span />}

                <button
                  data-testid="button-send"
                  className="aero-btn"
                  onClick={() => sendMutation.mutate()}
                  disabled={!canSend}
                >
                  {sendMutation.isPending
                    ? <><RefreshCw className="w-4 h-4 animate-spin" />Sending…</>
                    : <><Send className="w-4 h-4" />Send Message</>}
                </button>
              </div>
            </>
          )}
        </Panel>

        {/* AI Test Console */}
        <div className="glass-panel overflow-hidden flex flex-col" style={{ minHeight: 420 }}>
          <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4" style={{ color: "rgba(125,211,252,0.9)" }} />
              <h3 className="text-sm font-bold tracking-wide text-white">AI Test Console</h3>
            </div>
            {testHistory.length > 0 && (
              <button
                className="aero-btn aero-btn-ghost aero-btn-sm"
                onClick={() => setTestHistory([])}
                data-testid="button-clear-test"
              >
                <XCircle className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>

          <div
            ref={testScrollRef}
            data-testid="div-ai-test-feed"
            className="flex-1 overflow-y-auto p-3 space-y-2"
            style={{ maxHeight: 300 }}
          >
            {testHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-10 gap-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                <FlaskConical className="w-8 h-8 opacity-30" />
                <p className="text-xs text-center">Type a message below to test the AI.<br />Responses use the same pipeline as Discord.</p>
              </div>
            ) : (
              testHistory.map((entry, i) => (
                <div
                  key={i}
                  data-testid={`test-msg-${i}`}
                  className={`rounded-xl px-3 py-2 text-xs leading-relaxed max-w-[90%] ${entry.role === "user" ? "ml-auto" : "mr-auto"}`}
                  style={
                    entry.role === "user"
                      ? { background: "rgba(56,189,248,0.18)", border: "1px solid rgba(56,189,248,0.3)", color: "rgba(255,255,255,0.9)" }
                      : { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }
                  }
                >
                  <span className="block text-xs font-semibold mb-1" style={{ color: entry.role === "user" ? "rgba(125,211,252,0.8)" : "rgba(255,255,255,0.4)" }}>
                    {entry.role === "user" ? "You" : "bubbl manager"}
                  </span>
                  {entry.text}
                </div>
              ))
            )}
            {aiTestMutation.isPending && (
              <div className="rounded-xl px-3 py-2 text-xs mr-auto" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                <span className="block text-xs font-semibold mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>bubbl manager</span>
                thinking…
              </div>
            )}
          </div>

          <div className="p-3 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex gap-2">
              <Input
                data-testid="input-ai-test"
                placeholder="Type a test message…"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value.slice(0, 500))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && testInput.trim() && !aiTestMutation.isPending) {
                    e.preventDefault();
                    aiTestMutation.mutate(testInput.trim());
                  }
                }}
                disabled={aiTestMutation.isPending}
                className="aero-input h-9 text-xs"
              />
              <button
                data-testid="button-send-test"
                className="aero-btn flex-shrink-0 h-9 px-3"
                disabled={!testInput.trim() || aiTestMutation.isPending}
                onClick={() => aiTestMutation.mutate(testInput.trim())}
              >
                {aiTestMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        </div>{/* end send+test grid */}

        {/* QOTD + Service Health row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        <Panel title="QOTD Control" icon={CalendarClock}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-xs font-semibold tracking-wider uppercase mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>Next Type</p>
                <p className="text-sm font-bold text-white capitalize" data-testid="text-qotd-next-type">
                  {qotdStatus ? (qotdStatus.nextType === "open" ? "Open Question" : "Poll (2 choices)") : "—"}
                </p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-xs font-semibold tracking-wider uppercase mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>Next Post</p>
                <p className="text-sm font-bold text-white" data-testid="text-qotd-next-at">
                  {qotdStatus ? new Date(qotdStatus.nextAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "—"}
                </p>
              </div>
            </div>

            {qotdStatus?.last ? (
              <div className="rounded-xl p-3 space-y-1" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Last sent · <span className="normal-case capitalize">{qotdStatus.last.type}</span> · {new Date(qotdStatus.last.sentAt).toLocaleDateString()}
                </p>
                <p className="text-sm text-white leading-snug" data-testid="text-qotd-last-question">
                  {qotdStatus.last.question}
                </p>
                {qotdStatus.last.optionA && (
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                    {qotdStatus.last.optionA} vs {qotdStatus.last.optionB}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)" }}>
                No QOTD sent yet. Use the button below to send the first one.
              </div>
            )}

            <button
              data-testid="button-trigger-qotd"
              className="aero-btn w-full justify-center"
              onClick={() => qotdTriggerMutation.mutate()}
              disabled={!status?.online || qotdTriggerMutation.isPending}
            >
              {qotdTriggerMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Sending…</>
                : <><Play className="w-4 h-4" />Send QOTD Now</>}
            </button>
            <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
              Sends next type immediately · resets 24h timer
            </p>
          </div>
        </Panel>

        <Panel title="Service Health" icon={ShieldCheck}>
          <div className="space-y-3">
            <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Process uptime</span>
                <span className="text-sm font-bold text-white" data-testid="text-process-uptime">
                  {serviceHealth ? formatUptime(serviceHealth.processStartTime) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Keep-alive pings</span>
                <span
                  className="text-sm font-bold"
                  style={{ color: serviceHealth?.keepAliveEnabled ? "rgb(74,222,128)" : "rgb(250,204,21)" }}
                  data-testid="text-keepalive-status"
                >
                  {serviceHealth ? (serviceHealth.keepAliveEnabled ? "Active" : "Dev mode") : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Bot connection</span>
                <span
                  className="text-sm font-bold flex items-center gap-1.5"
                  style={{ color: status?.online ? "rgb(74,222,128)" : "rgb(248,113,113)" }}
                  data-testid="text-health-bot-status"
                >
                  <StatusDot status={status?.status ?? "offline"} />
                  {status?.online ? "Online" : "Offline"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Health endpoint</span>
                <a
                  href="/health"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold"
                  style={{ color: "rgba(125,211,252,0.8)" }}
                  data-testid="link-health-endpoint"
                >
                  /health ↗
                </a>
              </div>
            </div>

            {!serviceHealth?.keepAliveEnabled && (
              <div className="rounded-xl px-3 py-2 flex items-start gap-2 text-xs" style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.2)", color: "rgba(255,255,255,0.6)" }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "rgb(250,204,21)" }} />
                Keep-alive pings are inactive. Set <code className="mx-1 px-1 rounded" style={{ background: "rgba(255,255,255,0.1)" }}>RENDER_EXTERNAL_URL</code> on Render to enable them.
              </div>
            )}

            <div className="rounded-xl px-3 py-2 flex items-start gap-2 text-xs" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", color: "rgba(255,255,255,0.5)" }}>
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "rgba(125,211,252,0.7)" }} />
              Bot commands: <code className="mx-1">!ping</code> <code className="mx-1">!status</code> <code className="mx-1">!info</code> <code className="mx-1">!help</code> <code className="mx-1">!bubbl &lt;msg&gt;</code>
            </div>
          </div>
        </Panel>

        </div>{/* end qotd+health grid */}

        {!statusLoading && (isError || status?.lastError) && (
          <div
            className="glass-panel p-4 flex items-start gap-3"
            style={{ borderColor: "rgba(248,113,113,0.4)", background: "rgba(220,38,38,0.1)" }}
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "rgb(248,113,113)" }} />
            <div className="space-y-1">
              <p className="text-sm font-semibold" style={{ color: "rgb(248,113,113)" }}>Connection error</p>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }} data-testid="text-error-message">
                {status?.lastError ?? "Could not reach the bot. Check that your TOKEN is valid."}
              </p>
            </div>
          </div>
        )}

        <p className="text-center text-xs" style={{ color: "rgba(255,255,255,0.3)" }} data-testid="text-footer">
          Status · 5s &nbsp;·&nbsp; QOTD · 60s &nbsp;·&nbsp; Health · 30s
        </p>
      </div>
    </div>
  );
}
