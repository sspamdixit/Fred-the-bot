import { useEffect, useState, useCallback } from "react";
import { useLocation, useRoute } from "wouter";

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

function NumericBar({
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
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {[...Array(max + 1)].map((_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={`flex-1 h-8 rounded text-xs font-semibold transition-colors border ${
              i === value
                ? "bg-white text-[#111] border-white"
                : i < value
                ? "bg-white/15 border-white/20 text-white/50 hover:bg-white/20"
                : "bg-transparent border-white/[0.08] text-white/20 hover:bg-white/5"
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

function NumericScale({
  value,
  max,
  onChange,
  labels,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  labels?: Record<number, string>;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {[...Array(max)].map((_, i) => {
          const v = i + 1;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              className={`flex-1 h-9 rounded text-xs font-semibold transition-colors border ${
                v === value
                  ? "bg-white text-[#111] border-white"
                  : v < value
                  ? "bg-white/15 border-white/20 text-white/50 hover:bg-white/20"
                  : "bg-transparent border-white/[0.08] text-white/20 hover:bg-white/5"
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>
      {labels && labels[value] && (
        <p className="text-xs text-white/35">{labels[value]}</p>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-7 border-b border-white/[0.07]">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
        <div className="sm:w-52 shrink-0">
          <p className="text-sm font-semibold text-white mb-1">{label}</p>
          <p className="text-xs text-white/35 leading-relaxed">{hint}</p>
        </div>
        <div className="flex-1 max-w-sm">{children}</div>
      </div>
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
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(saved);

  useEffect(() => {
    if (!guildId) return;
    Promise.all([
      fetch(`/api/public/guilds/${guildId}/info`, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
      fetch(`/api/public/guilds/${guildId}/settings`, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([guildInfo, guildSettings]) => {
        if (!guildInfo) { navigate("/servers"); return; }
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
    if (!guildId || !isDirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/public/guilds/${guildId}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, personaOverride: settings.personaOverride?.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
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
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: any) {
      setError(err.message);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  };

  const update = useCallback(<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center">
        <span className="text-sm text-white/30">Loading…</span>
      </div>
    );
  }

  const temperatureLabels: Record<number, string> = {
    1: "Precise — consistent, factual, predictable",
    2: "Grounded",
    3: "Balanced",
    4: "Creative",
    5: "Inventive",
    6: "Loose",
    7: "Free-ranging",
    8: "Unpredictable",
    9: "Wild",
    10: "Unhinged",
  };

  const lengthLabels: Record<number, string> = {
    1: "Minimal — one or two sentences, always",
    2: "Short — brief by default",
    3: "Normal — Fred's default",
    4: "Generous — detailed when it helps",
    5: "Thorough — goes long when warranted",
  };

  return (
    <div className="min-h-screen bg-[#111111] text-[#f0f0f0]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.07] bg-[#111111]/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/servers")}
              className="text-sm text-white/30 hover:text-white/70 transition-colors"
            >
              ← servers
            </button>
            {guild && (
              <div className="flex items-center gap-2">
                <span className="text-white/15">·</span>
                {guild.iconUrl ? (
                  <img src={guild.iconUrl} alt={guild.name} className="w-5 h-5 rounded" />
                ) : null}
                <span className="text-sm text-white/50">{guild.name}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isDirty && (
              <button
                onClick={() => setSettings(saved)}
                className="text-sm text-white/30 hover:text-white/60 transition-colors"
              >
                Discard
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isDirty && !saving
                  ? "bg-white text-[#111] hover:bg-white/90"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              }`}
            >
              {saving ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : saveStatus === "error" ? "Error" : "Save"}
            </button>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-20 px-6 max-w-3xl mx-auto">

        {guild && !guild.hasFred && (
          <div className="mb-8 p-4 rounded-lg border border-white/[0.1] bg-white/[0.03]">
            <p className="text-sm text-white/60 mb-1 font-medium">Fred isn't in this server yet</p>
            <p className="text-xs text-white/30 mb-3">Settings will save, but Fred needs to be added before they take effect.</p>
            <a
              href={`/api/public/invite-url?guild_id=${guild.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/50 hover:text-white/80 transition-colors underline underline-offset-4"
            >
              Add Fred to this server →
            </a>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-500/20 bg-red-500/5">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="mb-10">
          <h1 className="text-2xl font-bold text-white mb-1">Server settings</h1>
          <p className="text-sm text-white/30">Configure how Fred behaves in {guild?.name ?? "this server"}.</p>
        </div>

        <div className="border-t border-white/[0.07]">

          <Row
            label="Custom persona"
            hint="Fully replaces Fred's default personality for this server. Write a complete character description. Leave blank to keep the default."
          >
            <textarea
              value={settings.personaOverride ?? ""}
              onChange={(e) => update("personaOverride", e.target.value)}
              placeholder="e.g. you are a no-nonsense assistant for a game dev server. you know unity, unreal, and godot inside out. you are concise, technical, and mildly sarcastic about scope creep."
              rows={4}
              maxLength={1000}
              className="w-full bg-white/[0.04] border border-white/[0.1] focus:border-white/25 focus:outline-none rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 resize-none transition-colors"
            />
            <p className="mt-1.5 text-xs text-white/20 text-right">
              {(settings.personaOverride ?? "").length}/1000
            </p>
          </Row>

          <Row
            label="Temperature"
            hint="How creative and unpredictable Fred's responses are. Low = consistent. High = surprising."
          >
            <NumericScale
              value={settings.temperature}
              max={10}
              onChange={(v) => update("temperature", v)}
              labels={temperatureLabels}
            />
          </Row>

          <Row
            label="Chattiness"
            hint="How often Fred joins conversations he wasn't directly addressed in."
          >
            <NumericBar
              value={settings.chattiness}
              max={10}
              onChange={(v) => update("chattiness", v)}
              lowLabel="Only when mentioned"
              highLabel="Jumps in constantly"
            />
          </Row>

          <Row
            label="Proactivity"
            hint="How often Fred starts conversations on his own — dead chat revivals, observations, check-ins."
          >
            <NumericBar
              value={settings.proactivity}
              max={10}
              onChange={(v) => update("proactivity", v)}
              lowLabel="Never initiates"
              highLabel="Constantly active"
            />
          </Row>

          <Row
            label="Memory"
            hint="Fred builds and uses long-term memory of users and server lore. Disable for a stateless experience."
          >
            <button
              onClick={() => update("memoryEnabled", !settings.memoryEnabled)}
              className="flex items-center gap-3 group"
            >
              <div className={`w-10 h-5.5 rounded-full relative transition-colors ${settings.memoryEnabled ? "bg-white" : "bg-white/15"}`}
                style={{ height: "22px" }}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full shadow transition-transform ${settings.memoryEnabled ? "translate-x-5 bg-[#111]" : "translate-x-0.5 bg-white/50"}`} />
              </div>
              <span className="text-sm text-white/50 group-hover:text-white/70 transition-colors">
                {settings.memoryEnabled ? "Enabled" : "Disabled"}
              </span>
            </button>
          </Row>

          <Row
            label="Response length"
            hint="Fred's default verbosity. His baseline is short — this raises the ceiling."
          >
            <NumericScale
              value={settings.responseLength}
              max={5}
              onChange={(v) => update("responseLength", v)}
              labels={lengthLabels}
            />
          </Row>

          <Row
            label="Language"
            hint="Response language. Auto mirrors what users write in. Force English or Dutch for consistency."
          >
            <div className="flex gap-2">
              {[
                { value: "auto", label: "Auto" },
                { value: "en", label: "English" },
                { value: "nl", label: "Dutch" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update("language", opt.value)}
                  className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                    settings.language === opt.value
                      ? "bg-white text-[#111] border-white"
                      : "bg-transparent border-white/[0.1] text-white/40 hover:border-white/25 hover:text-white/60"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Row>

        </div>

        {isDirty && (
          <div className="mt-8 flex justify-end gap-3">
            <button
              onClick={() => setSettings(saved)}
              className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Discard changes
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
