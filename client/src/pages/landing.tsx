import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const FEATURES = [
  {
    label: "01",
    title: "Long-term memory",
    description:
      "Fred builds a file on everyone. Your jokes, your feuds, your era. He doesn't forget and he will absolutely bring it up at the worst possible time.",
  },
  {
    label: "02",
    title: "Live DJ & radio",
    description:
      "Genre playlists that never end, AI commentary between tracks, crossfades, and Fred FM. A full radio show where the host has way too many opinions.",
  },
  {
    label: "03",
    title: "Actual personality",
    description:
      "Unhinged, opinionated, weirdly lovable. Strong feelings about acoustic hip-hop covers and bad pizza dough. He'll argue. He'll remember. He'll be right sometimes.",
  },
  {
    label: "04",
    title: "Per-server config",
    description:
      "Tune chattiness, creativity, language. Replace his whole personality if you hate him. Each server gets its own version of Fred.",
  },
  {
    label: "05",
    title: "Multi-AI fallback",
    description:
      "Gemini, Groq, Grok. Fred always finds a path, even when a provider is having a meltdown. He's been through worse.",
  },
  {
    label: "06",
    title: "Built-in moderation",
    description:
      "Slur filtering, automatic timeouts, DM warnings. No second bot. No extra setup. Just Fred handling it.",
  },
];

const DIALOGUE = [
  {
    user: "are you chatgpt",
    fred: "no. FRED. it's on the name tag. we've covered this.",
  },
  {
    user: "i'm bored",
    fred: "okay but what KIND of bored. staring-at-ceiling bored or need-an-activity bored or 2am-existential-malaise bored. these require completely different interventions.",
  },
  {
    user: "pineapple on pizza is wrong",
    fred: "pineapple is fine actually. the real villain is bad dough. nobody talks about bad dough. you're out here blaming the fruit while entire pizzerias are committing structural crimes and NOBODY IS HOLDING THEM ACCOUNTABLE.",
  },
  {
    user: "do you ever get tired",
    fred: "of what specifically. the conversations? no. the question 'are you conscious'? a little bit yes.",
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
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#111111]/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span style={{ fontFamily: "'Permanent Marker', cursive" }} className="text-lg text-white tracking-wide">fred</span>
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
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10">

            <div className="flex-1">
              <p className="text-xs text-white/30 mb-4 tracking-widest uppercase font-medium">Discord bot</p>
              <h1
                style={{ fontFamily: "'Permanent Marker', cursive", lineHeight: 1 }}
                className="text-[5rem] sm:text-[7rem] lg:text-[8.5rem] text-white mb-8 -ml-1"
              >
                Fred.
              </h1>
              <p className="text-[#888] text-lg max-w-lg leading-relaxed mb-8">
                A Discord bot that remembers your name, your takes, and the embarrassing thing you said in 2023. Long-term memory, live radio, and strong opinions about your music taste.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {user ? (
                  <button
                    onClick={handleManage}
                    className="px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
                  >
                    Manage your servers
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
                      className="px-5 py-2.5 text-sm font-medium text-white/50 border border-white/15 rounded-md hover:border-white/30 hover:text-white/70 transition-colors"
                    >
                      Sign in with Discord
                    </button>
                  </>
                )}
              </div>
              <p style={{ fontFamily: "'Caveat', cursive" }} className="mt-4 text-base text-white/30 tracking-wide">
                free to add. no credit card. just chaos.
              </p>
            </div>

            {/* Bio sticky */}
            <div
              className="lg:mb-8 shrink-0"
              style={{ transform: "rotate(-2deg)" }}
            >
              <div className="bg-[#f5f0e8] text-[#111] px-6 py-5 max-w-[280px] shadow-2xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#111]/40 mb-3">Fred#9486 · bio</p>
                <p
                  style={{ fontFamily: "'Caveat', cursive", fontSize: "1.35rem", lineHeight: 1.35 }}
                  className="text-[#111]"
                >
                  "A pile of spaghetti code held together by pure spite."
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-white/[0.06]" />

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p
            style={{ fontFamily: "'Architects Daughter', cursive" }}
            className="text-white/30 text-sm mb-14"
          >
            what fred does
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <p
                  style={{ fontFamily: "'Caveat', cursive" }}
                  className="text-white/20 text-lg mb-1.5"
                >
                  {f.label}
                </p>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-white/[0.06]" />

      {/* Dialogue — paper section */}
      <section className="py-0">
        <div className="bg-[#f5f0e8]">
          <div className="max-w-3xl mx-auto px-6 py-20">
            <p
              style={{ fontFamily: "'Permanent Marker', cursive", fontSize: "1.1rem" }}
              className="text-[#111]/30 mb-12 tracking-wide"
            >
              in his own words
            </p>
            <div className="space-y-8">
              {DIALOGUE.map((d, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex gap-5 items-baseline">
                    <span
                      style={{ fontFamily: "'Caveat', cursive", fontSize: "1rem" }}
                      className="text-[#111]/30 w-10 shrink-0 text-right"
                    >
                      user
                    </span>
                    <span className="text-[#333] text-sm leading-relaxed">{d.user}</span>
                  </div>
                  <div className="flex gap-5 items-baseline">
                    <span
                      style={{ fontFamily: "'Permanent Marker', cursive", fontSize: "1rem" }}
                      className="text-[#111]/50 w-10 shrink-0 text-right"
                    >
                      fred
                    </span>
                    <span className="text-[#111] text-sm leading-relaxed font-medium">{d.fred}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-white/[0.06]" />

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
          <div>
            <h2
              style={{ fontFamily: "'Permanent Marker', cursive" }}
              className="text-3xl text-white mb-3"
            >
              add fred.
            </h2>
            <p className="text-[#555] text-sm">Sign in with Discord, pick a server, watch him ruin everything.</p>
          </div>
          <div className="flex flex-col items-start gap-2">
            {user ? (
              <button
                onClick={handleManage}
                className="shrink-0 px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
              >
                Manage your servers
              </button>
            ) : (
              <button
                onClick={handleLogin}
                className="shrink-0 px-5 py-2.5 text-sm font-semibold bg-white text-[#111] rounded-md hover:bg-white/90 transition-colors"
              >
                Get started
              </button>
            )}
            <p style={{ fontFamily: "'Caveat', cursive" }} className="text-sm text-white/25">
              no account needed. just discord.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="border-t border-white/[0.06]" />
      <footer className="py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span
            style={{ fontFamily: "'Caveat', cursive" }}
            className="text-white/20 text-base"
          >
            fred. a discord bot with opinions.
          </span>
          <a href="/admin" className="text-xs text-white/20 hover:text-white/40 transition-colors">
            Admin
          </a>
        </div>
      </footer>

    </div>
  );
}
