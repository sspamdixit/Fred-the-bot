import { useEffect, useState, useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft,
  Bot,
  Save,
  RotateCcw,
  Thermometer,
  MessageSquare,
  Zap,
  Brain,
  AlignLeft,
  Globe,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Plus,
} from "lucide-react";

interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  hasFred: boolean;
}

interface GuildSettings {
  personaOverride: string | null;
  temperature: number;
  chattiness: number;
  proactivity: number;
  memoryEnabled: boolean;
  responseLength: number;
  language: string;
}

const DEFAULTS: GuildSettings = {
  personaOverride: "",
  temperature: 7,
  chattiness: 5,
  proactivity: 3,
  memoryEnabled: true,
  responseLength: 3,
  language: "auto",
};

function StarRating({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[...Array(max)].map((_, i) => {
        const star = i + 1;
        const filled = hover ? star <= hover : star <= value;
        return (
          <button
            key={star}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all ${
              filled
                ? "bg-blue-500/20 border border-blue-500/40 text-blue-400"
                : "bg-white/5 border border-white/10 text-white/20 hover:text-white/40"
            }`}
          >
            {star}
          </button>
        );
      })}
      {label && <span className="ml-2 text-xs text-white/30">{label}</span>}
    </div>
  );
}

function BarSlider({
  value,
  max,
  onChange,
  lowLabel,
  highLabel,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  lowLabel?: string;
  highLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {[...Array(max + 1)].map((_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={`flex-1 h-8 rounded-md text-xs font-semibold transition-all border ${
              i === value
                ? "bg-blue-500/30 border-blue-500/60 text-blue-300"
                : i < value
                ? "bg-blue-500/10 border-blue-500/20 text-blue-400/50 hover:bg-blue-500/20"
                : "bg-white/3 border-white/8 text-white/20 hover:bg-white/8"
            }`}
          >
            {i}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="flex justify-between text-xs text-white/25">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}

function SettingCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white text-sm mb-1">{title}</h3>
          <p className="text-xs text-white/40 leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export default function ServerSettingsPage() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/servers/:guildId");
  const guildId = match ? params?.guildId : null;

  const [guild, setGuild] = useState<GuildInfo | null>(null);
  const [settings, setSettings] = useState<GuildSettings>(DEFAULTS);
  const [saved, setSaved] = useState<GuildSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(saved);

  useEffect(() => {
    if (!guildId) return;
    Promise.all([
      fetch(`/api/public/guilds/${guildId}/info`, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/public/guilds/${guildId}/settings`, { credentials: "include" }).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([guildInfo, guildSettings]) => {
        if (!guildInfo) {
          navigate("/servers");
          return;
        }
        setGuild(guildInfo);
        if (guildSettings) {
          const s: GuildSettings = {
            personaOverride: guildSettings.personaOverride ?? "",
            temperature: guildSettings.temperature ?? 7,
            chattiness: guildSettings.chattiness ?? 5,
            proactivity: guildSettings.proactivity ?? 3,
            memoryEnabled: guildSettings.memoryEnabled ?? true,
            responseLength: guildSettings.responseLength ?? 3,
            language: guildSettings.language ?? "auto",
          };
          setSettings(s);
          setSaved(s);
        }
      })
      .catch(() => setError("Failed to load settings."))
      .finally(() => setLoading(false));
  }, [guildId, navigate]);

  const handleSave = async () => {
    if (!guildId || !isDirty) return;
    setSaving(true);
    setSaveStatus("idle");
    try {
      const res = await fetch(`/api/public/guilds/${guildId}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          personaOverride: settings.personaOverride?.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      const updated = await res.json();
      const s: GuildSettings = {
        personaOverride: updated.personaOverride ?? "",
        temperature: updated.temperature ?? 7,
        chattiness: updated.chattiness ?? 5,
        proactivity: updated.proactivity ?? 3,
        memoryEnabled: updated.memoryEnabled ?? true,
        responseLength: updated.responseLength ?? 3,
        language: updated.language ?? "auto",
      };
      setSettings(s);
      setSaved(s);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      setSaveStatus("error");
      setError(err.message);
      setTimeout(() => setSaveStatus("idle"), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(saved);
  };

  const update = useCallback(<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0b0f] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/40 text-sm">Loading settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b0f] text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0a0b0f]/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/servers")}
              className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Servers
            </button>
            {guild && (
              <>
                <div className="w-px h-4 bg-white/10" />
                <div className="flex items-center gap-2">
                  {guild.iconUrl ? (
                    <img src={guild.iconUrl} alt={guild.name} className="w-6 h-6 rounded-lg" />
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-xs font-semibold">
                      {guild.name.slice(0, 1)}
                    </div>
                  )}
                  <span className="text-sm font-medium text-white/70">{guild.name}</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isDirty && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-sm transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:block">Reset</span>
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isDirty && !saving
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                  : "bg-white/5 text-white/30 cursor-not-allowed"
              }`}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saveStatus === "success" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              ) : saveStatus === "error" ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saveStatus === "success"
                ? "Saved"
                : saveStatus === "error"
                ? "Error"
                : "Save"}
            </button>
          </div>
        </div>
      </nav>

      <main className="pt-28 pb-16 px-6 max-w-3xl mx-auto">
        {guild && !guild.hasFred && (
          <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-300 font-medium mb-1">Fred isn't in this server yet</p>
              <p className="text-xs text-yellow-400/60 mb-2">
                Settings will be saved but Fred needs to be added before they take effect.
              </p>
              <a
                href={`/api/public/invite-url?guild_id=${guild.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Fred to this server
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="mb-8">
          <h1 className="text-xl font-bold mb-1">Server Settings</h1>
          <p className="text-white/40 text-sm">
            Configure how Fred behaves in this server. Changes save instantly.
          </p>
        </div>

        <div className="space-y-4">
          <SettingCard
            icon={User}
            title="Custom Persona"
            description="Add server-specific personality notes. This is appended to Fred's base character — use it to tune his focus, set inside context, or give him a server nickname."
          >
            <textarea
              value={settings.personaOverride ?? ""}
              onChange={(e) => update("personaOverride", e.target.value)}
              placeholder="e.g. this is a music production server — lean into production knowledge, mention DAWs and sample culture when relevant"
              rows={4}
              maxLength={1000}
              className="w-full bg-white/5 border border-white/10 focus:border-blue-500/50 focus:outline-none rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 resize-none transition-colors"
            />
            <div className="mt-1.5 text-right text-xs text-white/20">
              {(settings.personaOverride ?? "").length}/1000
            </div>
          </SettingCard>

          <SettingCard
            icon={Thermometer}
            title="Temperature"
            description="How creative and unpredictable Fred's responses are. Low = more consistent and factual. High = more creative, surprising, and occasionally unhinged."
          >
            <StarRating
              value={settings.temperature}
              max={10}
              onChange={(v) => update("temperature", v)}
              label={
                settings.temperature <= 3
                  ? "Precise"
                  : settings.temperature <= 6
                  ? "Balanced"
                  : settings.temperature <= 8
                  ? "Creative"
                  : "Unhinged"
              }
            />
          </SettingCard>

          <SettingCard
            icon={MessageSquare}
            title="Chattiness"
            description="How often Fred responds to messages that aren't directly addressed to him. 0 = only responds when mentioned. 10 = jumps into almost every conversation."
          >
            <BarSlider
              value={settings.chattiness}
              max={10}
              onChange={(v) => update("chattiness", v)}
              lowLabel="Only when mentioned"
              highLabel="Jumps in constantly"
            />
          </SettingCard>

          <SettingCard
            icon={Zap}
            title="Proactivity"
            description="How often Fred starts conversations on his own — dead chat revivals, random observations, checking in. 0 = never. 10 = very active."
          >
            <BarSlider
              value={settings.proactivity}
              max={10}
              onChange={(v) => update("proactivity", v)}
              lowLabel="Silent unless spoken to"
              highLabel="Constantly initiating"
            />
          </SettingCard>

          <SettingCard
            icon={Brain}
            title="Memory"
            description="When enabled, Fred builds and uses a long-term memory of users and server lore. Disable if you want a stateless Fred with no recall."
          >
            <button
              onClick={() => update("memoryEnabled", !settings.memoryEnabled)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                settings.memoryEnabled
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                  : "bg-white/3 border-white/8 text-white/30"
              }`}
            >
              <div
                className={`w-9 h-5 rounded-full relative transition-colors ${
                  settings.memoryEnabled ? "bg-blue-500" : "bg-white/10"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    settings.memoryEnabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </div>
              <span className="text-sm font-medium">
                {settings.memoryEnabled ? "Memory enabled" : "Memory disabled"}
              </span>
            </button>
          </SettingCard>

          <SettingCard
            icon={AlignLeft}
            title="Response Length"
            description="How verbose Fred is by default. 1 = very short, punchy replies. 5 = detailed when the topic calls for it. Fred's baseline is short, so this raises the ceiling."
          >
            <StarRating
              value={settings.responseLength}
              max={5}
              onChange={(v) => update("responseLength", v)}
              label={
                settings.responseLength === 1
                  ? "Minimal"
                  : settings.responseLength === 2
                  ? "Short"
                  : settings.responseLength === 3
                  ? "Normal"
                  : settings.responseLength === 4
                  ? "Detailed"
                  : "Thorough"
              }
            />
          </SettingCard>

          <SettingCard
            icon={Globe}
            title="Language"
            description="Fred's preferred response language. Auto mirrors the language users write in. Force English or Dutch if you want a consistent language across the server."
          >
            <div className="flex gap-2">
              {(["auto", "en", "nl"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => update("language", lang)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    settings.language === lang
                      ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                      : "bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:bg-white/8"
                  }`}
                >
                  {lang === "auto" ? "Auto" : lang === "en" ? "🇬🇧 English" : "🇳🇱 Dutch"}
                </button>
              ))}
            </div>
          </SettingCard>
        </div>

        {isDirty && (
          <div className="mt-8 flex justify-end gap-3">
            <button
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white text-sm transition-colors"
            >
              Discard changes
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save changes
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
