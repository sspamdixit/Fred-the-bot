import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import { createHash, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import {
  getBotStatus,
  getGuildsWithChannels,
  sendMessageToChannel,
  setBotPresence,
  dispatchMessage,
} from "./bot";
import { askGemini } from "./gemini";
import {
  getAIProviderStatuses,
  isAIProviderId,
  removeAIProviderApiKey,
  setAIProviderApiKey,
  setAIProviderEnabled,
  updateAIProviderOrder,
} from "./aiConfig";
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

  app.get("/api/ai/status", async (_req, res, next) => {
    try {
      const providers = await getAIProviderStatuses();
      const getProvider = (provider: string) => providers.find((item) => item.id === provider);
      res.json({
        providers,
        geminiEnabled: getProvider("gemini")?.enabled ?? false,
        groqEnabled: getProvider("groq")?.enabled ?? false,
        hackclubEnabled: getProvider("hackclub")?.enabled ?? false,
        hasGeminiKey: getProvider("gemini")?.hasKey ?? false,
        hasGroqKey: getProvider("groq")?.hasKey ?? false,
        hasHackclubKey: getProvider("hackclub")?.hasKey ?? false,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/ai/toggle", async (req, res, next) => {
    const schema = z.object({
      provider: z.enum(["gemini", "groq", "hackclub"]),
      enabled: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Expected { provider: 'gemini' | 'groq' | 'hackclub', enabled: boolean }" });
    }
    try {
      await setAIProviderEnabled(parsed.data.provider, parsed.data.enabled);
      const providers = await getAIProviderStatuses();
      return res.json({ providers });
    } catch (err) {
      return next(err);
    }
  });

  app.post("/api/ai/key", async (req, res, next) => {
    const schema = z.object({
      provider: z.enum(["gemini", "groq", "hackclub"]),
      apiKey: z.string().min(1).max(4096),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Expected { provider, apiKey }." });
    }
    try {
      await setAIProviderApiKey(parsed.data.provider, parsed.data.apiKey);
      const providers = await getAIProviderStatuses();
      return res.json({ providers });
    } catch (err) {
      return next(err);
    }
  });

  app.delete("/api/ai/key/:provider", async (req, res, next) => {
    const provider = req.params.provider;
    if (!isAIProviderId(provider)) {
      return res.status(400).json({ error: "Unknown AI provider." });
    }
    try {
      await removeAIProviderApiKey(provider);
      const providers = await getAIProviderStatuses();
      return res.json({ providers });
    } catch (err) {
      return next(err);
    }
  });

  app.post("/api/ai/order", async (req, res, next) => {
    const schema = z.object({
      providers: z.array(z.enum(["gemini", "groq", "hackclub"])).length(3),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Expected provider order with gemini, groq, and hackclub." });
    }
    try {
      await updateAIProviderOrder(parsed.data.providers);
      const providers = await getAIProviderStatuses();
      return res.json({ providers });
    } catch (err) {
      return next(err);
    }
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

  return httpServer;
}