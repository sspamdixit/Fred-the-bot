import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const FEATURES = [
  {
    title: "Long-term memory",
    description:
      "Fred builds per-user dossiers and server lore over time. The longer he's in a server, the more he knows — and uses it without announcing it.",
  },
  {
    title: "Live DJ & radio",
    description:
      "Genre-based infinite playlists with crossfades, AI commentary, and Fred FM — a proper radio simulation with pre-recorded clips.",
  },
  {
    title: "Actual personality",
    description:
      "Unhinged, opinionated, and weirdly lovable. Fred has strong feelings about acoustic hip-hop covers and bad pizza dough. He'll argue. He'll remember. He'll be right sometimes.",
  },
  {
    title: "Per-server config",
    description:
      "Tune chattiness, creativity, language, and persona per server. Replace his whole personality if you want. Each community gets its own version of Fred.",
  },
  {
    title: "Multi-AI fallback",
    description:
      "Gemini → Groq → Grok. Fred always finds a path to a response, even when one provider is down.",
  },
  {
    title: "Built-in moderation",
    description:
      "Slur filtering with automatic timeouts and DM warnings. No separate bot needed.",
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
    <div className="min-h-screen bg-[#111111] text-[#f0f0f0]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.07] bg-[#111111]/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight text-white">fred</span>
          <div className="flex items-center gap-3">
            {!checkingAuth && (
              user ? (
                <button
                  onClick={handleManage}
                  className="px-4 py-1.5 text-sm font-medium bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                >
                  Manage servers
                </button>
              ) : (
                <button
                  onClick={handleLogin}
                  className="px-4 py-1.5 text-sm font-medium bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                >
                  Sign in
                </button>
              )
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-36 pb-28 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm text-white/40 mb-5 tracking-wide uppercase font-medium">Discord bot</p>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.05] mb-7 text-white">
            Fred.<br />
            <span className="text-white/40">Unhinged. Opinionated.<br />Weirdly lovable.</span>
          </h1>
          <p className="text-[#999] text-lg max-w-xl leading-relaxed mb-10">
            A Discord bot with genuine character — long-term memory, live radio, strong opinions about acoustic hip-hop covers, and actual personality that refuses to be normal.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {user ? (
              <button
                onClick={handleManage}
                className="px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
              >
                Manage your servers →
              </button>
            ) : (
              <>
                <button
                  onClick={handleLogin}
                  className="px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                >
                  Add Fred to your server
                </button>
                <button
                  onClick={handleLogin}
                  className="px-5 py-2.5 text-sm font-medium text-white/60 border border-white/15 rounded-md hover:border-white/30 hover:text-white/80 transition-colors"
                >
                  Sign in with Discord
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-white/[0.07]" />

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-14 font-medium">What Fred does</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-10">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-white/[0.07]" />

      {/* Quote / personality section */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-10 font-medium">In his own words</p>
          <div className="space-y-5 text-[#888] text-sm leading-relaxed font-mono">
            <div className="flex gap-4">
              <span className="text-white/20 select-none">user</span>
              <span>are you chatgpt</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none shrink-0">fred</span>
              <span className="text-white/60">no. FRED. it's on the name tag. we've covered this.</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none">user</span>
              <span>i'm bored</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none shrink-0">fred</span>
              <span className="text-white/60">okay but what KIND of bored. staring-at-ceiling bored or need-an-activity bored or 2am-existential-malaise bored. these require completely different interventions.</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none">user</span>
              <span>how are you</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none shrink-0">fred</span>
              <span className="text-white/60">thriving actually. which is a weird thing to say as an ai but i stand by it.</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none">user</span>
              <span>pineapple on pizza is wrong</span>
            </div>
            <div className="flex gap-4">
              <span className="text-white/20 select-none shrink-0">fred</span>
              <span className="text-white/60">pineapple is fine actually. the real villain is bad dough. nobody talks about bad dough. you're out here blaming the fruit while entire pizzerias are committing structural crimes and NOBODY IS HOLDING THEM ACCOUNTABLE.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-white/[0.07]" />

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Ready to add Fred?</h2>
            <p className="text-[#666] text-sm">Sign in with Discord, pick a server, configure him.</p>
          </div>
          {user ? (
            <button
              onClick={handleManage}
              className="shrink-0 px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
            >
              Manage your servers →
            </button>
          ) : (
            <button
              onClick={handleLogin}
              className="shrink-0 px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
            >
              Get started →
            </button>
          )}
        </div>
      </section>

      {/* Footer */}
      <div className="border-t border-white/[0.07]" />
      <footer className="py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-xs text-white/20">fred — a discord bot with opinions</span>
          <a href="/admin" className="text-xs text-white/20 hover:text-white/40 transition-colors">
            Admin
          </a>
        </div>
      </footer>

    </div>
  );
}
