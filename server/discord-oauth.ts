import type { Request, Response } from "express";
import { log } from "./index";

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
  approximate_member_count?: number;
}

const DISCORD_API = "https://discord.com/api/v10";
const SCOPES = "identify guilds";

export function getRedirectUri(req: Request): string {
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("host") ?? "localhost:5000";
  return `${proto}://${host}/api/oauth/discord/callback`;
}

export function getOAuthUrl(req: Request): string {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) throw new Error("DISCORD_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(req),
    response_type: "code",
    scope: SCOPES,
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

export function getBotInviteUrl(guildId?: string): string {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) throw new Error("DISCORD_CLIENT_ID is not set");
  const permissions = "277025770560";
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions,
    ...(guildId ? { guild_id: guildId } : {}),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string, req: Request): Promise<string | null> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    log("DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set", "oauth");
    return null;
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(req),
  });
  try {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      log(`Token exchange failed ${res.status}: ${text}`, "oauth");
      return null;
    }
    const data = await res.json() as { access_token: string };
    return data.access_token;
  } catch (err: any) {
    log(`Token exchange error: ${err.message}`, "oauth");
    return null;
  }
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json() as DiscordUser;
  } catch {
    return null;
  }
}

export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    return await res.json() as DiscordGuild[];
  } catch {
    return [];
  }
}

export function hasManageGuild(permissions: string): boolean {
  const MANAGE_GUILD = BigInt(0x20);
  const ADMINISTRATOR = BigInt(0x8);
  try {
    const perms = BigInt(permissions);
    return (perms & ADMINISTRATOR) !== BigInt(0) || (perms & MANAGE_GUILD) !== BigInt(0);
  } catch {
    return false;
  }
}

export function getAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const disc = parseInt(user.discriminator ?? "0") || 0;
  return `https://cdn.discordapp.com/embed/avatars/${disc % 5}.png`;
}

export function getGuildIconUrl(guild: DiscordGuild): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}
