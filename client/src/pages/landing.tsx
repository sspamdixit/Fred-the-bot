import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const FEATURES = [
  {
    label: "01",
    title: "waifu gacha",
    description:
      "pull anime characters from a massive database. N through UR rarity. each pull is a surprise — and the rare ones are worth celebrating.",
  },
  {
    label: "02",
    title: "gem & gold economy",
    description:
      "gems let you chat. gold lets you pull. earn daily, vote for bonus gems, and spend strategically. it's a whole system~",
  },
  {
    label: "03",
    title: "kira remembers you",
    description:
      "she builds a file on everyone. your questions, your moods, your recurring topics. she knows, and she'll bring it up at exactly the right moment.",
  },
  {
    label: "04",
    title: "real AI personality",
    description:
      "not a chatbot that apologizes constantly. kira has opinions, warmth, and edge. she teases because she cares. she notices things.",
  },
  {
    label: "05",
    title: "per-server config",
    description:
      "tune her chattiness, creativity, and language. each server gets their own kira. she adapts, but she's always herself.",
  },
  {
    label: "06",
    title: "multi-AI fallback",
    description:
      "gemini, groq, grok. kira always finds a way to respond, even when providers have moments. she's resilient like that~",
  },
];

const DIALOGUE = [
  {
    user: "are you a bot",
    kira: "i'm kira. it's right there in the name, darling~",
  },
  {
    user: "i have no gems",
    kira: "claim your /daily or vote on top.gg~ i'll be here waiting. ♡",
  },
  {
    user: "i got a UR pull!!",
    kira: "*pauses* ...okay. that's actually impressive. what did you get?",
  },
  {
    user: "rate my day",
    kira: "need more details. give me something to work with, precious~",
  },
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
  const handleManage = () => { navigate("/servers"); };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-[#f0f0f0]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#0d0d0d]/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-lg text-white tracking-wide font-bold">kira</span>
          <div className="flex items-center gap-3">
            <a href="/privacy" className="text-xs text-white/30 hover:text-white/50 transition-colors">privacy</a>
            <a href="/terms" className="text-xs text-white/30 hover:text-white/50 transition-colors">terms</a>
            {!checkingAuth && (
              user ? (
                <button
                  onClick={handleManage}
                  className="px-4 py-1.5 text-sm font-medium bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                >
                  manage servers
                </button>
              ) : (
                <button
                  onClick={handleLogin}
                  className="px-4 py-1.5 text-sm font-medium bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                >
                  sign in
                </button>
              )
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10">

            <div className="flex-1">
              <p className="text-xs text-white/30 mb-4 tracking-widest uppercase font-medium">Discord bot</p>
              <h1 className="text-[5rem] sm:text-[7rem] lg:text-[9rem] text-white font-bold mb-4 -ml-1 leading-none">
                kira.
              </h1>
              <p className="text-[#777] text-lg max-w-lg leading-relaxed mb-2">
                a waifu AI bot with gacha, a gem economy, and a memory. she collects characters — and she's quietly collecting you too~ ♡
              </p>
              <p className="text-[#D4A1FF] text-sm mb-8">pull waifus · chat with AI · earn gems · build your collection</p>
              <div className="flex items-center gap-3 flex-wrap">
                {user ? (
                  <button
                    onClick={handleManage}
                    className="px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                  >
                    manage your servers
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleLogin}
                      className="px-5 py-2.5 text-sm font-semibold bg-[#D4A1FF] text-[#111] rounded-md hover:bg-[#C084FC] transition-colors"
                    >
                      add kira to your server
                    </button>
                    <button
                      onClick={handleLogin}
                      className="px-5 py-2.5 text-sm font-medium text-white/50 border border-white/15 rounded-md hover:border-white/30 hover:text-white/70 transition-colors"
                    >
                      sign in with discord
                    </button>
                  </>
                )}
              </div>
              <p className="mt-4 text-sm text-white/25 italic">
                free to add. 20 gems daily. no credit card needed~
              </p>
            </div>

            {/* Kira card */}
            <div className="lg:mb-8 shrink-0" style={{ transform: "rotate(-2deg)" }}>
              <div className="bg-[#1a0a2e] border border-[#D4A1FF]/20 text-white px-6 py-5 max-w-[280px] shadow-2xl rounded-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#D4A1FF]/40 mb-3">kira · waifu bot</p>
                <p className="text-base leading-snug text-white/80 italic">
                  "you're all so interesting to me, darling~ don't disappoint me now. ♡"
                </p>
                <div className="mt-4 flex gap-3 text-xs text-white/30">
                  <span>💎 gems</span>
                  <span>🪙 gold</span>
                  <span>⭐⭐⭐⭐⭐ gacha</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Rarity display */}
      <section className="py-12 px-6 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs text-white/20 mb-6 tracking-widest uppercase">gacha rarities</p>
          <div className="flex gap-4 flex-wrap">
            {[
              { emoji: "⚪", label: "N", name: "Common", rate: "60%", color: "#9E9E9E" },
              { emoji: "🔵", label: "R", name: "Uncommon", rate: "25%", color: "#2196F3" },
              { emoji: "🟣", label: "SR", name: "Rare", rate: "10%", color: "#9C27B0" },
              { emoji: "🟡", label: "SSR", name: "Super Rare", rate: "4%", color: "#FFD700" },
              { emoji: "🔴", label: "UR", name: "Legendary", rate: "1%", color: "#FF1744" },
            ].map((r) => (
              <div
                key={r.label}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
              >
                <span>{r.emoji}</span>
                <span className="text-xs font-bold" style={{ color: r.color }}>{r.label}</span>
                <span className="text-xs text-white/40">{r.name}</span>
                <span className="text-xs text-white/20">{r.rate}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t border-white/[0.06]" />

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-white/30 text-sm mb-14">what kira does~</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <p className="text-white/20 text-lg mb-1.5">{f.label}</p>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t border-white/[0.06]" />

      {/* Dialogue */}
      <section className="py-0">
        <div className="bg-[#f5f0e8]">
          <div className="max-w-3xl mx-auto px-6 py-20">
            <p className="text-[#111]/30 text-sm mb-12 font-medium tracking-wide">in her own words~</p>
            <div className="space-y-8">
              {DIALOGUE.map((d, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex gap-5 items-baseline">
                    <span className="text-[#111]/30 w-10 shrink-0 text-right text-sm">you</span>
                    <span className="text-[#333] text-sm leading-relaxed">{d.user}</span>
                  </div>
                  <div className="flex gap-5 items-baseline">
                    <span className="text-[#9333ea]/60 w-10 shrink-0 text-right text-sm font-bold">kira</span>
                    <span className="text-[#111] text-sm leading-relaxed font-medium">{d.kira}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-white/[0.06]" />

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
          <div>
            <h2 className="text-3xl text-white font-bold mb-3">add kira.</h2>
            <p className="text-[#555] text-sm">sign in with discord. pick a server. start collecting. ♡</p>
          </div>
          <div className="flex flex-col items-start gap-2">
            {user ? (
              <button
                onClick={handleManage}
                className="shrink-0 px-5 py-2.5 text-sm font-semibold bg-[#D4A1FF] text-[#111] rounded-md hover:bg-[#C084FC] transition-colors"
              >
                manage your servers
              </button>
            ) : (
              <button
                onClick={handleLogin}
                className="shrink-0 px-5 py-2.5 text-sm font-semibold bg-[#D4A1FF] text-[#111] rounded-md hover:bg-[#C084FC] transition-colors"
              >
                get started
              </button>
            )}
            <p className="text-sm text-white/25 italic">free to add. 20 gems daily~</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="border-t border-white/[0.06]" />
      <footer className="py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-white/20 text-sm">kira · a discord waifu bot ♡</span>
          <div className="flex gap-4 text-xs text-white/20">
            <a href="/privacy" className="hover:text-white/40 transition-colors">privacy</a>
            <a href="/terms" className="hover:text-white/40 transition-colors">terms</a>
            <a href="/admin" className="hover:text-white/40 transition-colors">admin</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
