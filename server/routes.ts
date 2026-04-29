import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { type Server } from "http";
import path from "path";
import { createHash, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import {
  getBotStatus,
  getGuildsWithChannels,
  sendMessageToChannel,
  setBotPresence,
  dispatchMessage,
  startBot,
} from "./bot";
import { getGeminiEnabled, setGeminiEnabled, getGroqEnabled, setGroqEnabled, getHackclubEnabled, setHackclubEnabled, askGemini, NEWS_FEEDS, fetchRssHeadlines, generateBotStatus } from "./gemini";
import { triggerQotdNow, getQotdStatus } from "./qotd";
import { z } from "zod";
import { DASHBOARD_AUTH_HEADER, issueAuthToken, isAuthTokenValid } from "./auth";

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

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again later." },
});
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

function safePasswordEquals(input: string, expected: string): boolean {
  const inputDigest = createHash("sha256").update(input).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(inputDigest, expectedDigest);
}

function ensureApiAuthorized(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/auth") {
    return next();
  }

  const providedToken = req.get(DASHBOARD_AUTH_HEADER);
  if (!providedToken || !isAuthTokenValid(providedToken)) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  return next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Public CDN for radio audio so Lavalink nodes can fetch the assets over
  // HTTP. These directories must remain public — Lavalink doesn't carry auth
  // headers when resolving track URLs.
  const audioStaticOpts = {
    fallthrough: false,
    maxAge: "1h",
    etag: true,
    immutable: false,
  } as const;
  app.use("/radio-cdn/assets", express.static(path.resolve("radio_assets"), audioStaticOpts));
  app.use("/radio-cdn/music", express.static(path.resolve("music_library"), audioStaticOpts));

  app.use("/api", apiRateLimiter);

  app.post("/api/auth", authRateLimiter, (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Password required." });
    }

    const dashboardPassword = process.env.DASHBOARD_PASSWORD;
    if (!dashboardPassword) {
      return res.status(503).json({ error: "DASHBOARD_PASSWORD is not configured on the server." });
    }

    if (!safePasswordEquals(parsed.data.password, dashboardPassword)) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const token = issueAuthToken();

    return res.json({ ok: true, token });
  });

  app.use("/api", ensureApiAuthorized);

  app.get("/api/bot/status", (_req, res) => {
    res.json(getBotStatus());
  });

  app.get("/api/bot/guilds", (_req, res) => {
    res.json(getGuildsWithChannels());
  });

  app.post("/api/bot/send", async (req, res) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    }
    const { channelId, content } = parsed.data;
    const result = await sendMessageToChannel(channelId, content);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json({ success: true });
  });

  app.post("/api/bot/presence", async (req, res) => {
    const parsed = presenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    }
    const { status, activityType, activityName } = parsed.data;
    const result = await setBotPresence(status, activityType, activityName);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json({ success: true });
  });

  app.post("/api/bot/restart", async (_req, res) => {
    res.json({ success: true, message: "Bot restarting…" });
    await startBot();
  });

  app.post("/api/dispatch", async (req, res) => {
    const parsed = dispatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    }
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
    if (!parsed.success) {
      return res.status(400).json({ error: "Expected { provider: 'gemini' | 'groq' | 'hackclub', enabled: boolean }" });
    }
    if (parsed.data.provider === "gemini") {
      setGeminiEnabled(parsed.data.enabled);
    } else if (parsed.data.provider === "groq") {
      setGroqEnabled(parsed.data.enabled);
    } else {
      setHackclubEnabled(parsed.data.enabled);
    }
    return res.json({ geminiEnabled: getGeminiEnabled(), groqEnabled: getGroqEnabled(), hackclubEnabled: getHackclubEnabled() });
  });

  app.post("/api/ai/test", async (req, res) => {
    const schema = z.object({ message: z.string().min(1).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Message required (max 500 chars)." });
    const reply = await askGemini(parsed.data.message, "Dashboard", "dashboard-ai-test");
    return res.json({ reply: reply ?? "(no response from AI)" });
  });

  app.get("/api/qotd/status", (_req, res) => {
    return res.json(getQotdStatus());
  });

  app.post("/api/qotd/trigger", async (_req, res) => {
    const result = await triggerQotdNow();
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.json({ ok: true, type: result.type });
  });

  app.get("/api/service/health", (_req, res) => {
    return res.json({
      processStartTime: PROCESS_START_TIME,
      keepAliveEnabled: !!process.env.RENDER_EXTERNAL_URL,
      renderUrl: process.env.RENDER_EXTERNAL_URL ?? null,
    });
  });

  app.post("/api/diagnostics/run", async (_req, res) => {
    const checkedAt = Date.now();

    // Bot check
    const botInfo = getBotStatus();
    const botCheck = {
      status: botInfo.online ? "pass" : "fail" as "pass" | "fail" | "warn",
      online: botInfo.online,
      tag: botInfo.tag,
      guildCount: botInfo.guildCount,
      uptimeStart: botInfo.uptimeStart,
      lastError: botInfo.lastError,
    };

    // AI provider checks
    const aiChecks: Record<string, { status: "pass" | "fail" | "warn" | "skip"; hasKey: boolean; enabled: boolean; latencyMs?: number; error?: string }> = {
      gemini: { status: "skip", hasKey: !!process.env.GEMINI_API_KEY, enabled: getGeminiEnabled() },
      groq: { status: "skip", hasKey: !!process.env.GROQ_API_KEY, enabled: getGroqEnabled() },
      hackclub: { status: "skip", hasKey: !!process.env.HACKCLUB_API_KEY, enabled: getHackclubEnabled() },
    };

    // Quick AI ping via Gemini (if key exists)
    if (process.env.GEMINI_API_KEY) {
      try {
        const t0 = Date.now();
        const reply = await askGemini("reply with only the word pong", "DiagSystem", "diag-ping", {});
        const latencyMs = Date.now() - t0;
        aiChecks.gemini = { ...aiChecks.gemini, status: reply ? "pass" : "warn", latencyMs };
      } catch (e: any) {
        aiChecks.gemini = { ...aiChecks.gemini, status: "fail", error: e.message };
      }
    } else {
      aiChecks.gemini = { ...aiChecks.gemini, status: "fail", error: "No GEMINI_API_KEY set" };
    }

    if (process.env.GROQ_API_KEY) {
      aiChecks.groq = { ...aiChecks.groq, status: aiChecks.groq.enabled ? "pass" : "warn" };
    } else {
      aiChecks.groq = { ...aiChecks.groq, status: "fail", error: "No GROQ_API_KEY set" };
    }

    if (process.env.HACKCLUB_API_KEY) {
      aiChecks.hackclub = { ...aiChecks.hackclub, status: aiChecks.hackclub.enabled ? "pass" : "warn" };
    } else {
      aiChecks.hackclub = { ...aiChecks.hackclub, status: "warn", error: "No HACKCLUB_API_KEY set" };
    }

    // News feed checks
    const feedResults: Array<{ category: string; url: string; status: "pass" | "fail"; headlineCount: number; sample?: string }> = [];
    for (const [category, urls] of Object.entries(NEWS_FEEDS)) {
      for (const url of urls) {
        try {
          const headlines = await fetchRssHeadlines(url);
          feedResults.push({ category, url, status: headlines.length > 0 ? "pass" : "fail", headlineCount: headlines.length, sample: headlines[0] });
        } catch {
          feedResults.push({ category, url, status: "fail", headlineCount: 0 });
        }
      }
    }

    // Bot status generation check
    let botStatusCheck: { status: "pass" | "fail" | "skip"; generated?: string; error?: string } = { status: "skip" };
    if (process.env.GROQ_API_KEY) {
      try {
        const generated = await generateBotStatus();
        botStatusCheck = { status: generated ? "pass" : "fail", generated: generated ?? undefined, error: generated ? undefined : "AI returned nothing" };
      } catch (e: any) {
        botStatusCheck = { status: "fail", error: e.message };
      }
    } else {
      botStatusCheck = { status: "fail", error: "No GROQ_API_KEY set" };
    }

    // QOTD check
    const qotdInfo = getQotdStatus();
    const qotdCheck = {
      status: "pass" as "pass" | "warn",
      nextType: qotdInfo.nextType,
      nextAt: qotdInfo.nextAt,
      last: qotdInfo.last,
    };

    // Service check
    const serviceCheck = {
      processUptimeMs: Date.now() - PROCESS_START_TIME,
      keepAliveEnabled: !!process.env.RENDER_EXTERNAL_URL,
    };

    return res.json({ checkedAt, bot: botCheck, ai: aiChecks, newsFeeds: feedResults, botStatus: botStatusCheck, qotd: qotdCheck, service: serviceCheck });
  });

  return httpServer;
}