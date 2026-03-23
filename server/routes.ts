import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import {
  getBotStatus,
  getGuildsWithChannels,
  sendMessageToChannel,
  setBotPresence,
  dispatchMessage,
} from "./bot";
import { z } from "zod";
import { DASHBOARD_AUTH_HEADER, issueAuthToken, isAuthTokenValid } from "./auth";

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
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
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

  return httpServer;
}
