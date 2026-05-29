import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Bot,
  ChevronRight,
  Plus,
  Settings2,
  Users,
  LogOut,
  ArrowLeft,
  Crown,
} from "lucide-react";

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
  approximate_member_count?: number;
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
        if (!me?.id) {
          navigate("/");
          return;
        }
        setUser(me);
        setGuilds(guildData?.guilds ?? []);
        setInviteUrl(inviteData?.url ?? "");
      })
      .catch(() => setError("Failed to load — please try again."))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleLogout = async () => {
    await fetch("/api/oauth/logout", { method: "POST", credentials: "include" });
    navigate("/");
  };

  const handleAddFred = (guildId: string) => {
    if (!inviteUrl) return;
    const url = `${inviteUrl}&guild_id=${guildId}&disable_guild_select=true`;
    window.open(url, "_blank");
  };

  const handleConfigure = (guildId: string) => {
    navigate(`/servers/${guildId}`);
  };

  const fredGuilds = guilds.filter((g) => g.hasFred);
  const otherGuilds = guilds.filter((g) => !g.hasFred);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0b0f] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/40 text-sm">Loading your servers…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0b0f] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b0f] text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0a0b0f]/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <span className="font-semibold text-sm">Fred</span>
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="w-7 h-7 rounded-full"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/60">
                    {(user.global_name ?? user.username)[0].toUpperCase()}
                  </div>
                )}
                <span className="text-sm text-white/60 hidden sm:block">
                  {user.global_name ?? user.username}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:block">Logout</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="pt-28 pb-16 px-6 max-w-5xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-bold mb-1">Your Servers</h1>
          <p className="text-white/40 text-sm">
            Showing servers where you have Manage Server permissions.
          </p>
        </div>

        {fredGuilds.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Fred is here
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {fredGuilds.map((guild) => (
                <GuildCard
                  key={guild.id}
                  guild={guild}
                  hasFred
                  onConfigure={() => handleConfigure(guild.id)}
                  onAdd={() => handleAddFred(guild.id)}
                />
              ))}
            </div>
          </section>
        )}

        {otherGuilds.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Add Fred
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {otherGuilds.map((guild) => (
                <GuildCard
                  key={guild.id}
                  guild={guild}
                  hasFred={false}
                  onConfigure={() => handleConfigure(guild.id)}
                  onAdd={() => handleAddFred(guild.id)}
                />
              ))}
            </div>
          </section>
        )}

        {guilds.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
              <Users className="w-6 h-6 text-white/20" />
            </div>
            <h3 className="text-white/60 font-medium mb-2">No servers found</h3>
            <p className="text-white/30 text-sm max-w-sm mx-auto">
              You need Manage Server permission in a server to configure Fred there.
            </p>
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
    <div className="group p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 hover:bg-white/[0.05] transition-all">
      <div className="flex items-start gap-3 mb-4">
        {guild.iconUrl ? (
          <img
            src={guild.iconUrl}
            alt={guild.name}
            className="w-11 h-11 rounded-xl flex-shrink-0"
          />
        ) : (
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-white/50">
            {guild.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-medium text-sm text-white truncate">{guild.name}</span>
            {guild.owner && (
              <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                hasFred ? "bg-green-400" : "bg-white/20"
              }`}
            />
            <span className="text-xs text-white/40">
              {hasFred ? "Fred active" : "Fred not added"}
            </span>
          </div>
        </div>
      </div>

      {hasFred ? (
        <button
          onClick={onConfigure}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 text-sm font-medium transition-all"
        >
          <Settings2 className="w-4 h-4" />
          Configure
        </button>
      ) : (
        <button
          onClick={onAdd}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Fred
        </button>
      )}
    </div>
  );
}
