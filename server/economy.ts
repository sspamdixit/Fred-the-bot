import { db } from "./db";
import { gemBalances } from "@shared/schema";
import { eq } from "drizzle-orm";
import { log } from "./index";

const FREE_DAILY_GEMS = 20;
const DAILY_GOLD_BONUS = 50;
const VOTE_FREE_GEMS = 10;
const GEM_COST_PER_MESSAGE = 1;

export interface Balance {
  userId: string;
  freeGems: number;
  paidGems: number;
  totalGems: number;
  gold: number;
  canChat: boolean;
  lastDailyAt: Date | null;
  lastVoteAt: Date | null;
}

async function ensureBalance(userId: string): Promise<typeof gemBalances.$inferSelect> {
  const existing = await db.select().from(gemBalances).where(eq(gemBalances.userId, userId)).limit(1);
  if (existing.length > 0) return existing[0];

  await db.insert(gemBalances).values({
    userId,
    freeGems: FREE_DAILY_GEMS,
    paidGems: 0,
    gold: DAILY_GOLD_BONUS,
  });
  const row = await db.select().from(gemBalances).where(eq(gemBalances.userId, userId)).limit(1);
  return row[0];
}

export async function getBalance(userId: string): Promise<Balance> {
  const row = await ensureBalance(userId);
  return {
    userId,
    freeGems: row.freeGems,
    paidGems: row.paidGems,
    totalGems: row.freeGems + row.paidGems,
    gold: row.gold,
    canChat: row.freeGems + row.paidGems > 0,
    lastDailyAt: row.lastDailyAt,
    lastVoteAt: row.lastVoteAt,
  };
}

export async function claimDaily(userId: string): Promise<{ success: boolean; reason?: string; freeGems: number; gold: number }> {
  const row = await ensureBalance(userId);
  const now = new Date();

  if (row.lastDailyAt) {
    const diff = now.getTime() - new Date(row.lastDailyAt).getTime();
    const hoursLeft = 24 - diff / (1000 * 60 * 60);
    if (hoursLeft > 0) {
      const h = Math.floor(hoursLeft);
      const m = Math.floor((hoursLeft - h) * 60);
      return { success: false, reason: `${h}h ${m}m`, freeGems: row.freeGems, gold: row.gold };
    }
  }

  const newFree = row.freeGems + FREE_DAILY_GEMS;
  const newGold = row.gold + DAILY_GOLD_BONUS;

  await db.update(gemBalances)
    .set({ freeGems: newFree, gold: newGold, lastDailyAt: now, updatedAt: now })
    .where(eq(gemBalances.userId, userId));

  return { success: true, freeGems: newFree, gold: newGold };
}

export async function deductGem(userId: string): Promise<{ success: boolean; remaining: number }> {
  const row = await ensureBalance(userId);
  const total = row.freeGems + row.paidGems;
  if (total <= 0) return { success: false, remaining: 0 };

  const now = new Date();
  if (row.freeGems > 0) {
    await db.update(gemBalances)
      .set({ freeGems: row.freeGems - 1, totalMessagesSent: row.totalMessagesSent + 1, updatedAt: now })
      .where(eq(gemBalances.userId, userId));
    return { success: true, remaining: row.freeGems - 1 + row.paidGems };
  } else {
    await db.update(gemBalances)
      .set({ paidGems: row.paidGems - 1, totalMessagesSent: row.totalMessagesSent + 1, updatedAt: now })
      .where(eq(gemBalances.userId, userId));
    return { success: true, remaining: row.paidGems - 1 };
  }
}

export async function deductGold(userId: string, amount: number): Promise<{ success: boolean; remaining: number }> {
  const row = await ensureBalance(userId);
  if (row.gold < amount) return { success: false, remaining: row.gold };
  const newGold = row.gold - amount;
  await db.update(gemBalances)
    .set({ gold: newGold, updatedAt: new Date() })
    .where(eq(gemBalances.userId, userId));
  return { success: true, remaining: newGold };
}

export async function addGold(userId: string, amount: number): Promise<number> {
  const row = await ensureBalance(userId);
  const newGold = row.gold + amount;
  await db.update(gemBalances)
    .set({ gold: newGold, updatedAt: new Date() })
    .where(eq(gemBalances.userId, userId));
  return newGold;
}

export async function incrementPulls(userId: string, count: number): Promise<void> {
  const row = await ensureBalance(userId);
  await db.update(gemBalances)
    .set({ totalPulls: row.totalPulls + count, updatedAt: new Date() })
    .where(eq(gemBalances.userId, userId));
}

export async function awardVoteGems(userId: string): Promise<{ alreadyVoted: boolean; freeGems: number }> {
  const row = await ensureBalance(userId);
  const now = new Date();

  if (row.lastVoteAt) {
    const diff = now.getTime() - new Date(row.lastVoteAt).getTime();
    if (diff < 12 * 60 * 60 * 1000) {
      return { alreadyVoted: true, freeGems: row.freeGems };
    }
  }

  const newFree = row.freeGems + VOTE_FREE_GEMS;
  await db.update(gemBalances)
    .set({ freeGems: newFree, lastVoteAt: now, updatedAt: now })
    .where(eq(gemBalances.userId, userId));

  return { alreadyVoted: false, freeGems: newFree };
}

export { FREE_DAILY_GEMS, DAILY_GOLD_BONUS, VOTE_FREE_GEMS, GEM_COST_PER_MESSAGE };
