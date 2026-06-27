import type { Request, Response } from "express";
import { awardVoteGems } from "./economy";
import { db } from "./db";
import { votingLog } from "@shared/schema";
import { log } from "./index";

const TOPGG_BOT_ID = process.env.TOPGG_BOT_ID ?? "";
const TOPGG_WEBHOOK_SECRET = process.env.TOPGG_WEBHOOK_SECRET ?? "";

const TOPGG_ENABLED = false;

export function getTopGGVoteUrl(): string {
  return `https://top.gg/bot/${TOPGG_BOT_ID}/vote`;
}

export async function handleTopGGWebhook(req: Request, res: Response): Promise<void> {
  if (!TOPGG_ENABLED) {
    res.status(503).json({ error: "Voting webhook not yet active." });
    return;
  }

  const authHeader = req.headers["authorization"];
  if (TOPGG_WEBHOOK_SECRET && authHeader !== TOPGG_WEBHOOK_SECRET) {
    log("top.gg webhook: unauthorized", "topgg");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as { user?: string; type?: string; isWeekend?: boolean };

  if (!body.user) {
    res.status(400).json({ error: "Missing user" });
    return;
  }

  const userId = body.user;
  const isWeekend = body.isWeekend ?? false;

  try {
    const result = await awardVoteGems(userId);

    if (!result.alreadyVoted) {
      await db.insert(votingLog).values({
        userId,
        platform: "topgg",
        gemsAwarded: 10,
      });
      log(`top.gg vote recorded for user ${userId}, gems awarded`, "topgg");
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    log(`top.gg webhook error: ${err.message}`, "topgg");
    res.status(500).json({ error: "Internal error" });
  }
}
