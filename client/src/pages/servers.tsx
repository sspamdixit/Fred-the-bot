import { useEffect, useState } from "react";
import { useLocation } from "wouter";

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  avatarUrl: string;
}

interface ManagedGuild {
  id: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
  hasFred: boolean;
}

export default function ServersPage() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [guilds, setGuilds] = useState<ManagedGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string>("");

  useEffect(() => {
    Promise.all([
      fetch("/api/oauth/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/public/guilds", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/public/invite-url", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([me, guildData, inviteData]) => {
        if (!me?.id) { navigate("/"); return; }
        setUser(me);
        setGuilds(guildData?.guilds ?? []);
        setInviteUrl(inviteData?.url ?? "");
      })
      .catch(() => setError("Failed to load. Please try again."))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleLogout = async () => {
    await fetch("/api/oauth/logout", { method: "POST", credentials: "include" });
    navigate("/");
  };

  const handleAddFred = (guildId: string) => {
    if (!inviteUrl) return;
    window.open(`${inviteUrl}&guild_id=${guildId}&disable_guild_select=true`, "_blank");
  };

  const fredGuilds = guilds.filter((g) => g.hasFred);
  const otherGuilds = guilds.filter((g) => !g.hasFred);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center">
        <span className="text-sm text-white/30">Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-white/50 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-white/40 hover:text-white/70 transition-colors underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] text-[#f0f0f0]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>

      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.07] bg-[#111111]/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="text-sm text-white/30 hover:text-white/70 transition-colors"
            >
              ← fred
            </button>
          </div>
          {user && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-white/30 hidden sm:block">
                {user.global_name ?? user.username}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-white/30 hover:text-white/60 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="pt-24 pb-20 px-6 max-w-5xl mx-auto">
        <div className="mb-12">
          <h1 className="text-2xl font-bold text-white mb-1">Your servers</h1>
          <p className="text-sm text-white/30">
            Servers where you have Manage Server permission.
          </p>
        </div>

        {fredGuilds.length > 0 && (
          <section className="mb-12">
            <p className="text-xs text-white/25 uppercase tracking-widest font-medium mb-5">Fred is here</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {fredGuilds.map((guild) => (
                <GuildCard
                  key={guild.id}
                  guild={guild}
                  hasFred
                  onConfigure={() => navigate(`/servers/${guild.id}`)}
                  onAdd={() => handleAddFred(guild.id)}
                />
              ))}
            </div>
          </section>
        )}

        {otherGuilds.length > 0 && (
          <section className="mb-12">
            <p className="text-xs text-white/25 uppercase tracking-widest font-medium mb-5">Add Fred</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {otherGuilds.map((guild) => (
                <GuildCard
                  key={guild.id}
                  guild={guild}
                  hasFred={false}
                  onConfigure={() => navigate(`/servers/${guild.id}`)}
                  onAdd={() => handleAddFred(guild.id)}
                />
              ))}
            </div>
          </section>
        )}

        {guilds.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-sm text-white/30">No servers found with Manage Server permission.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function GuildCard({
  guild,
  hasFred,
  onConfigure,
  onAdd,
}: {
  guild: ManagedGuild;
  hasFred: boolean;
  onConfigure: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="p-4 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-3 mb-4">
        {guild.iconUrl ? (
          <img src={guild.iconUrl} alt={guild.name} className="w-10 h-10 rounded-lg flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-white/8 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-white/40">
            {guild.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{guild.name}</p>
          <p className="text-xs text-white/30 mt-0.5">
            {hasFred ? "Active" : "Not added"}
          </p>
        </div>
      </div>

      {hasFred ? (
        <button
          onClick={onConfigure}
          className="w-full py-2 text-sm font-medium text-white border border-white/15 rounded-md hover:border-white/30 hover:bg-white/5 transition-colors"
        >
          Configure →
        </button>
      ) : (
        <button
          onClick={onAdd}
          className="w-full py-2 text-sm font-medium text-white/50 border border-white/8 rounded-md hover:border-white/20 hover:text-white/70 transition-colors"
        >
          Add Fred
        </button>
      )}
    </div>
  );
}
