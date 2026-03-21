import type { Express } from "express";
import { createServer, type Server } from "http";
import { getBotStatus, getGuildsWithChannels, sendMessageToChannel } from "./bot";
import { z } from "zod";

const sendMessageSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().min(1).max(2000),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    return res.json({ success: true });
  });

  return httpServer;
}
