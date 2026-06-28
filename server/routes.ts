import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { type Server } from "http";
import { createHash, timingSafeEqual } from "crypto";
import {
  getBotStatus,
  getGuildsWithChannels,
  sendMessageToChannel,
  setBotPresence,
  dispatchMessage,
  startBot,
  registerSlashCommands,
} from "./bot";
import { getGeminiEnabled, setGeminiEnabled, getGroqEnabled, setGroqEnabled, getHackclubEnabled, setHackclubEnabled, askGemini, NEWS_FEEDS, fetchRssHeadlines, generateBotStatus } from "./gemini";
import { triggerQotdNow, getQotdStatus } from "./qotd";
import { z } from "zod";
import { DASHBOARD_AUTH_HEADER, issueAuthToken, isAuthTokenValid } from "./auth";
import {
  getOAuthUrl,
  exchangeCode,
  fetchDiscordUser,
  fetchDiscordGuilds,
  getBotInviteUrl,
  getAvatarUrl,
  getGuildIconUrl,
  hasManageGuild,
  type DiscordGuild,
} from "./discord-oauth";
import { getGuildSettings, upsertGuildSettings } from "./guild-settings";
import { getGuildsWithChannels as getBotGuilds } from "./bot";
import { guildSettingsSchema } from "@shared/schema";
import { getBalance } from "./economy";
import { getCollection } from "./gacha";
import { handleTopGGWebhook } from "./topgg";

declare module "express-session" {
  interface SessionData {
    discordUserId?: string;
    discordUsername?: string;
    discordGlobalName?: string | null;
    discordAvatar?: string | null;
    discordAvatarUrl?: string;
    accessToken?: string;
  }
}

const PROCESS_START_TIME = Date.now();

const sendMessageSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().min(1).max(2000),
});

const presenceSchema = z.object({
  status: z.enum(["online", "idle", "dnd", "invisible"]),
  activityType: z.enum(["Playing", "Watching", "Listening", "Competing", "Streaming", "Custom"]),
  activityName: z.string().max(128),
});

const dispatchSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().min(1).max(2000),
  replyToId: z.string().optional(),
  mentionUserId: z.string().optional(),
});

const authSchema = z.object({
  password: z.string().min(1),
});

function safePasswordEquals(input: string, expected: string): boolean {
  const inputDigest = createHash("sha256").update(input).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(inputDigest, expectedDigest);
}

function ensureApiAuthorized(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/auth") return next();
  const providedToken = req.get(DASHBOARD_AUTH_HEADER);
  if (!providedToken || !isAuthTokenValid(providedToken)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  return next();
}

function ensureDiscordAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.discordUserId) {
    return res.status(401).json({ error: "Discord login required." });
  }
  return next();
}

const authRateLimiter = (req: Request, res: Response, next: NextFunction) => next();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── top.gg voting webhook (public) ────────────────────────────────────────
  app.post("/api/topgg/webhook", handleTopGGWebhook);

  // ── Discord OAuth ─────────────────────────────────────────────────────────

  app.get("/api/oauth/discord", (req, res) => {
    try {
      const url = getOAuthUrl(req);
      res.redirect(url);
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.get("/api/oauth/discord/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    if (!code) return res.redirect("/?error=no_code");
    const accessToken = await exchangeCode(code, req);
    if (!accessToken) return res.redirect("/?error=token_exchange");
    const user = await fetchDiscordUser(accessToken);
    if (!user) return res.redirect("/?error=user_fetch");
    req.session.discordUserId = user.id;
    req.session.discordUsername = user.username;
    req.session.discordGlobalName = user.global_name;
    req.session.discordAvatar = user.avatar;
    req.session.discordAvatarUrl = getAvatarUrl(user);
    req.session.accessToken = accessToken;
    return res.redirect("/servers");
  });

  app.get("/api/oauth/me", (req, res) => {
    if (!req.session?.discordUserId) return res.status(401).json({ error: "Not logged in." });
    return res.json({
      id: req.session.discordUserId,
      username: req.session.discordUsername,
      global_name: req.session.discordGlobalName,
      avatar: req.session.discordAvatar,
      avatarUrl: req.session.discordAvatarUrl,
    });
  });

  app.post("/api/oauth/logout", (req, res) => {
    req.session.destroy(() => {});
    res.json({ ok: true });
  });

  // ── Public guild routes ───────────────────────────────────────────────────

  app.get("/api/public/guilds", ensureDiscordAuth, async (req, res) => {
    const accessToken = req.session.accessToken;
    if (!accessToken) return res.status(401).json({ error: "No access token." });
    const discordGuilds = await fetchDiscordGuilds(accessToken);
    const managed = discordGuilds.filter((g) => hasManageGuild(g.permissions));
    const botGuildList = getBotGuilds();
    const botGuildIds = new Set(botGuildList.map((g) => g.id));
    const guilds = managed
      .map((g) => ({
        id: g.id, name: g.name, icon: g.icon,
        iconUrl: getGuildIconUrl(g), owner: g.owner,
        permissions: g.permissions, hasHiyori: botGuildIds.has(g.id),
      }))
      .sort((a, b) => {
        if (a.hasHiyori && !b.hasHiyori) return -1;
        if (!a.hasHiyori && b.hasHiyori) return 1;
        return a.name.localeCompare(b.name);
      });
    return res.json({ guilds });
  });

  app.get("/api/public/guilds/:guildId/info", ensureDiscordAuth, async (req, res) => {
    const { guildId } = req.params;
    const accessToken = req.session.accessToken;
    if (!accessToken) return res.status(401).json({ error: "No access token." });
    const discordGuilds = await fetchDiscordGuilds(accessToken);
    const guild = discordGuilds.find((g) => g.id === guildId);
    if (!guild || !hasManageGuild(guild.permissions)) return res.status(403).json({ error: "Access denied." });
    const botGuildList = getBotGuilds();
    return res.json({
      id: guild.id, name: guild.name, icon: guild.icon,
      iconUrl: getGuildIconUrl(guild), owner: guild.owner,
      hasHiyori: botGuildList.some((g) => g.id === guildId),
    });
  });

  app.get("/api/public/guilds/:guildId/settings", ensureDiscordAuth, async (req, res) => {
    const { guildId } = req.params;
    const accessToken = req.session.accessToken;
    if (!accessToken) return res.status(401).json({ error: "No access token." });
    const discordGuilds = await fetchDiscordGuilds(accessToken);
    const guild = discordGuilds.find((g) => g.id === guildId);
    if (!guild || !hasManageGuild(guild.permissions)) return res.status(403).json({ error: "Access denied." });
    const settings = await getGuildSettings(guildId);
    return res.json(settings);
  });

  app.put("/api/public/guilds/:guildId/settings", ensureDiscordAuth, async (req, res) => {
    const { guildId } = req.params;
    const accessToken = req.session.accessToken;
    if (!accessToken) return res.status(401).json({ error: "No access token." });
    const discordGuilds = await fetchDiscordGuilds(accessToken);
    const guild = discordGuilds.find((g) => g.id === guildId);
    if (!guild || !hasManageGuild(guild.permissions)) return res.status(403).json({ error: "Access denied." });
    const parsed = guildSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings.", details: parsed.error.flatten() });
    const updated = await upsertGuildSettings(guildId, parsed.data, req.session.discordUserId);
    return res.json(updated);
  });

  app.get("/invite", (req, res) => {
    try {
      const url = getBotInviteUrl();
      return res.redirect(url);
    } catch (err: any) {
      return res.status(503).send("Bot invite unavailable: " + err.message);
    }
  });

  app.get("/api/public/invite-url", (req, res) => {
    const guildId = req.query.guild_id as string | undefined;
    try {
      const url = getBotInviteUrl(guildId);
      if (req.query.guild_id) return res.redirect(url);
      return res.json({ url });
    } catch (err: any) {
      return res.status(503).json({ error: err.message });
    }
  });

  // ── Economy (public read, for dashboard display) ──────────────────────────

  app.get("/api/economy/:userId/balance", async (req, res) => {
    try {
      const bal = await getBalance(req.params.userId);
      return res.json(bal);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/economy/:userId/collection", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string ?? "1", 10);
      const data = await getCollection(req.params.userId, page);
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Admin dashboard auth ───────────────────────────────────────────────────

  app.post("/api/auth", authRateLimiter, (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Password required." });
    const dashboardPassword = process.env.DASHBOARD_PASSWORD;
    if (!dashboardPassword) return res.status(503).json({ error: "DASHBOARD_PASSWORD not configured." });
    if (!safePasswordEquals(parsed.data.password, dashboardPassword)) return res.status(401).json({ error: "Incorrect password." });
    const token = issueAuthToken();
    return res.json({ ok: true, token });
  });

  app.use("/api", ensureApiAuthorized);

  app.get("/api/bot/status", (_req, res) => res.json(getBotStatus()));

  app.get("/api/bot/guilds", (_req, res) => res.json(getGuildsWithChannels()));

  app.post("/api/bot/send", async (req, res) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    const result = await sendMessageToChannel(parsed.data.channelId, parsed.data.content);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json({ success: true });
  });

  app.post("/api/bot/presence", async (req, res) => {
    const parsed = presenceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    const { status, activityType, activityName } = parsed.data;
    const result = await setBotPresence(status, activityType, activityName);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json({ success: true });
  });

  app.post("/api/bot/restart", async (_req, res) => {
    res.json({ success: true, message: "Bot restarting…" });
    await startBot();
  });

  app.post("/api/bot/register-commands", async (_req, res) => {
    const result = await registerSlashCommands();
    return res.json(result);
  });

  app.post("/api/dispatch", async (req, res) => {
    const parsed = dispatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    const { channelId, content, replyToId, mentionUserId } = parsed.data;
    const result = await dispatchMessage(channelId, content, replyToId, mentionUserId);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json({ success: true });
  });

  app.get("/api/ai/status", (_req, res) => {
    res.json({
      geminiEnabled: getGeminiEnabled(),
      groqEnabled: getGroqEnabled(),
      hackclubEnabled: getHackclubEnabled(),
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasGroqKey: !!process.env.GROQ_API_KEY,
      hasHackclubKey: !!process.env.HACKCLUB_API_KEY,
    });
  });

  app.post("/api/ai/toggle", (req, res) => {
    const schema = z.object({
      provider: z.enum(["gemini", "groq", "hackclub"]),
      enabled: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Expected { provider, enabled }" });
    if (parsed.data.provider === "gemini") setGeminiEnabled(parsed.data.enabled);
    else if (parsed.data.provider === "groq") setGroqEnabled(parsed.data.enabled);
    else setHackclubEnabled(parsed.data.enabled);
    return res.json({ geminiEnabled: getGeminiEnabled(), groqEnabled: getGroqEnabled(), hackclubEnabled: getHackclubEnabled() });
  });

  app.post("/api/ai/test", async (req, res) => {
    const schema = z.object({ message: z.string().min(1).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Message required (max 500 chars)." });
    const reply = await askGemini(parsed.data.message, "Dashboard", "dashboard-ai-test");
    return res.json({ reply: reply ?? "(no response from AI)" });
  });

  app.get("/api/qotd/status", (_req, res) => res.json(getQotdStatus()));

  app.post("/api/qotd/trigger", async (_req, res) => {
    const result = await triggerQotdNow();
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.json({ ok: true, type: result.type });
  });

  app.get("/api/service/health", (_req, res) => {
    return res.json({
      processStartTime: PROCESS_START_TIME,
      keepAliveEnabled: !!(process.env.RENDER_EXTERNAL_URL || process.env.SERVICE_URL),
    });
  });

  app.post("/api/diagnostics/run", async (_req, res) => {
    const checkedAt = Date.now();
    const botInfo = getBotStatus();
    const aiChecks: Record<string, { status: "pass" | "fail" | "warn" | "skip"; hasKey: boolean; enabled: boolean; latencyMs?: number; error?: string }> = {
      gemini: { status: "skip", hasKey: !!process.env.GEMINI_API_KEY, enabled: getGeminiEnabled() },
      groq: { status: "skip", hasKey: !!process.env.GROQ_API_KEY, enabled: getGroqEnabled() },
      hackclub: { status: "skip", hasKey: !!process.env.HACKCLUB_API_KEY, enabled: getHackclubEnabled() },
    };
    if (process.env.GEMINI_API_KEY) {
      try {
        const t0 = Date.now();
        const reply = await askGemini("reply with only the word pong", "DiagSystem", "diag-ping", {});
        aiChecks.gemini = { ...aiChecks.gemini, status: reply ? "pass" : "warn", latencyMs: Date.now() - t0 };
      } catch (e: any) {
        aiChecks.gemini = { ...aiChecks.gemini, status: "fail", error: e.message };
      }
    } else {
      aiChecks.gemini = { ...aiChecks.gemini, status: "fail", error: "No GEMINI_API_KEY set" };
    }
    if (process.env.GROQ_API_KEY) aiChecks.groq = { ...aiChecks.groq, status: "pass" };
    else aiChecks.groq = { ...aiChecks.groq, status: "fail", error: "No GROQ_API_KEY set" };
    if (process.env.HACKCLUB_API_KEY) aiChecks.hackclub = { ...aiChecks.hackclub, status: "pass" };
    else aiChecks.hackclub = { ...aiChecks.hackclub, status: "warn", error: "No HACKCLUB_API_KEY set" };

    return res.json({
      checkedAt,
      bot: { online: botInfo.online, tag: botInfo.tag, guildCount: botInfo.guildCount, lastError: botInfo.lastError },
      ai: aiChecks,
    });
  });

  return httpServer;
}
