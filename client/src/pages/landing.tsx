import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const FEATURES = [
  {
    icon: "🎰",
    title: "Gacha System",
    description:
      "Pull anime characters from a database of thousands. Five rarity tiers from Common to Legendary. Duplicates return gold — nothing is wasted.",
  },
  {
    icon: "💎",
    title: "Gem & Gold Economy",
    description:
      "Gems for AI access. Gold for pulls. Earn both through daily rewards, server voting, and just showing up. Spend strategically.",
  },
  {
    icon: "🧠",
    title: "Persistent Memory",
    description:
      "Hiyori builds a file on everyone she talks to. Remembers context, past conversations, recurring topics. She notices things.",
  },
  {
    icon: "✨",
    title: "Real AI Personality",
    description:
      "Not a generic assistant. Hiyori has opinions, edge, and warmth. She adapts her tone to the room and the person.",
  },
  {
    icon: "⚙️",
    title: "Per-Server Config",
    description:
      "Tune response length, language, chattiness, and persona. Each server gets a version of Hiyori tuned to their community.",
  },
  {
    icon: "🔁",
    title: "Multi-AI Fallback",
    description:
      "Routes across Gemini, Groq, and Grok. When one provider has issues, another takes over. Near-zero downtime on AI responses.",
  },
];

const RARITIES = [
  { emoji: "⚪", label: "N", name: "Common", rate: "60%", color: "#9E9E9E" },
  { emoji: "🔵", label: "R", name: "Uncommon", rate: "25%", color: "#2196F3" },
  { emoji: "🟣", label: "SR", name: "Rare", rate: "10%", color: "#9C27B0" },
  { emoji: "🟡", label: "SSR", name: "Super Rare", rate: "4%", color: "#FFD700" },
  { emoji: "🔴", label: "UR", name: "Legendary", rate: "1%", color: "#FF1744" },
];

const DIALOGUE = [
  { user: "are you a bot", bot: "i'm hiyori. it's right there in the name, darling~" },
  { user: "i have no gems", bot: "claim your /daily or vote on top.gg~ i'll be here waiting. ♡" },
  { user: "i got a UR pull!!", bot: "*pauses* ...okay. that's actually impressive. what did you get?" },
  { user: "rate my day", bot: "need more details. give me something to work with, precious~" },
];

export default function LandingPage() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<{ username: string; global_name: string | null } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    fetch("/api/oauth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.id) setUser(data); })
      .catch(() => {})
      .finally(() => setCheckingAuth(false));
  }, []);

  const handleLogin = () => { window.location.href = "/api/oauth/discord"; };
  const handleAddToServer = () => { window.open("/invite", "_blank"); };
  const handleManage = () => { navigate("/servers"); };

  return (
    <div
      className="min-h-screen bg-[#080808] text-[#e8e8e8]"
      style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.07] bg-[#080808]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-white font-bold text-base tracking-tight">hiyori</span>
          <div className="flex items-center gap-6">
            <a href="/privacy" className="text-sm text-white/40 hover:text-white/70 transition-colors hidden sm:block">Privacy</a>
            <a href="/terms" className="text-sm text-white/40 hover:text-white/70 transition-colors hidden sm:block">Terms</a>
            {!checkingAuth && (
              user ? (
                <button
                  onClick={handleManage}
                  className="px-4 py-1.5 text-sm font-semibold bg-white text-black rounded-md hover:bg-white/90 transition-colors"
                >
                  Dashboard
                </button>
              ) : (
                <button
                  onClick={handleLogin}
                  className="px-4 py-1.5 text-sm font-semibold bg-white text-black rounded-md hover:bg-white/90 transition-colors"
                >
                  Sign In
                </button>
              )
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="pt-36 pb-28 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-widest text-[#9333ea]/70 uppercase mb-5">Discord Bot</p>
            <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold text-white leading-[0.95] tracking-tight mb-7">
              hiyori.
            </h1>
            <p className="text-xl text-white/50 leading-relaxed max-w-xl mb-3">
              An AI Discord bot with gacha character pulls, a gem-and-gold economy, and a memory that doesn't quit.
            </p>
            <p className="text-sm text-[#a855f7] mb-10">
              Pull characters · Chat with AI · Earn daily rewards · Build your collection
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {user ? (
                <button
                  onClick={handleManage}
                  className="px-6 py-3 text-sm font-semibold bg-[#9333ea] text-white rounded-lg hover:bg-[#7c3aed] transition-colors"
                >
                  Manage Servers
                </button>
              ) : (
                <>
                  <button
                    onClick={handleAddToServer}
                    className="px-6 py-3 text-sm font-semibold bg-[#9333ea] text-white rounded-lg hover:bg-[#7c3aed] transition-colors"
                  >
                    Add to Server
                  </button>
                  <button
                    onClick={handleLogin}
                    className="px-6 py-3 text-sm font-medium text-white/60 border border-white/15 rounded-lg hover:border-white/30 hover:text-white/80 transition-colors"
                  >
                    Sign in with Discord
                  </button>
                </>
              )}
            </div>
            <p className="mt-4 text-xs text-white/25">Free to add. 20 gems daily. No credit card needed.</p>
          </div>
        </div>
      </section>

      {/* ── Rarity strip ────────────────────────────────────────────────────── */}
      <section className="border-t border-b border-white/[0.06] py-6 px-6 bg-white/[0.01]">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-6 flex-wrap">
            <span className="text-xs font-semibold tracking-widest text-white/25 uppercase shrink-0">Rarity Tiers</span>
            <div className="flex gap-3 flex-wrap">
              {RARITIES.map((r) => (
                <div
                  key={r.label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.07]"
                >
                  <span className="text-sm">{r.emoji}</span>
                  <span className="text-xs font-bold" style={{ color: r.color }}>{r.label}</span>
                  <span className="text-xs text-white/40">{r.name}</span>
                  <span className="text-xs text-white/20">{r.rate}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-14">
            <p className="text-xs font-semibold tracking-widest text-white/30 uppercase mb-3">Features</p>
            <h2 className="text-3xl font-bold text-white">Everything in one bot.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.06] border border-white/[0.06] rounded-xl overflow-hidden">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-[#080808] p-7 hover:bg-white/[0.02] transition-colors">
                <span className="text-2xl mb-4 block">{f.icon}</span>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Economy explainer ───────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-xs font-semibold tracking-widest text-white/30 uppercase mb-3">Economy</p>
              <h2 className="text-3xl font-bold text-white mb-5">Two currencies. One system.</h2>
              <p className="text-white/50 leading-relaxed mb-8">
                Gems get you AI access. Gold gets you pulls. Both are earned through daily logins, server voting, and conversation. No paywalls to start — the economy rewards activity.
              </p>
              <div className="space-y-4">
                {[
                  { icon: "💎", label: "Gems", desc: "Spend to chat with Hiyori. Earn 20 free per day, 10 per vote." },
                  { icon: "🪙", label: "Gold", desc: "Spend on pulls. 100 per single pull, 900 for 10×. Earn 50 per daily." },
                  { icon: "🎰", label: "Pulls", desc: "Single or 10× pulls. Gold returns on duplicates. UR pulls are events." },
                ].map((item) => (
                  <div key={item.label} className="flex gap-4 items-start">
                    <span className="text-xl shrink-0 mt-0.5">{item.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <p className="text-sm text-white/40">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {[
                { cmd: "/daily", desc: `Claim 20 💎 gems + 50 🪙 gold` },
                { cmd: "/pull", desc: "Single character pull — 100 🪙" },
                { cmd: "/multipull", desc: "10× pulls — 900 🪙" },
                { cmd: "/balance", desc: "Check your gem and gold balance" },
                { cmd: "/collection", desc: "Browse your full collection" },
                { cmd: "/vote", desc: "Vote on top.gg for 10 bonus 💎" },
              ].map((item) => (
                <div
                  key={item.cmd}
                  className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.07]"
                >
                  <code className="text-sm text-[#c084fc] font-mono">{item.cmd}</code>
                  <span className="text-sm text-white/40">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Dialogue ────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-white/[0.06] bg-white/[0.015]">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-white/30 uppercase mb-10">In Her Own Words</p>
          <div className="space-y-6">
            {DIALOGUE.map((d, i) => (
              <div key={i} className="grid grid-cols-[80px_1fr] gap-4">
                <div className="text-right">
                  <span className="text-xs text-white/25 font-medium">you</span>
                </div>
                <p className="text-sm text-white/60">{d.user}</p>
                <div className="text-right">
                  <span className="text-xs text-[#a855f7] font-semibold">hiyori</span>
                </div>
                <p className="text-sm text-white font-medium">{d.bot}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
          <div>
            <h2 className="text-4xl font-bold text-white mb-3">Add Hiyori.</h2>
            <p className="text-white/40 text-sm">Sign in with Discord, pick a server, and start collecting.</p>
          </div>
          <div className="flex flex-col items-start gap-2 shrink-0">
            {user ? (
              <button
                onClick={handleManage}
                className="px-6 py-3 text-sm font-semibold bg-[#9333ea] text-white rounded-lg hover:bg-[#7c3aed] transition-colors"
              >
                Manage Servers
              </button>
            ) : (
              <button
                onClick={handleLogin}
                className="px-6 py-3 text-sm font-semibold bg-[#9333ea] text-white rounded-lg hover:bg-[#7c3aed] transition-colors"
              >
                Get Started — Free
              </button>
            )}
            <p className="text-xs text-white/25 pl-1">20 gems daily · No credit card</p>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <span className="text-white/20 text-sm">hiyori · a discord bot ♡</span>
          <div className="flex gap-6 text-xs text-white/25">
            <a href="/privacy" className="hover:text-white/50 transition-colors">Privacy Policy</a>
            <a href="/terms" className="hover:text-white/50 transition-colors">Terms of Service</a>
            <a href="/admin" className="hover:text-white/50 transition-colors">Admin</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
