import type { Express } from "express";
import { createServer, type Server } from "http";
import { getBotStatus } from "./bot";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/bot/status", (_req, res) => {
    const status = getBotStatus();
    res.json(status);
  });

  return httpServer;
}
