import { db } from "./db";
import { users, userMemory, botMeta } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { type User, type InsertUser, type UserMemory } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUserMemory(userId: string): Promise<UserMemory | undefined>;
  upsertUserMemory(userId: string, possibilities: string, sureties: string): Promise<UserMemory>;
  deleteUserMemory(userId: string): Promise<boolean>;
  getBotMeta(key: string): Promise<string | null>;
  setBotMeta(key: string, value: string): Promise<void>;
}

export async function ensureUserMemoryTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT PRIMARY KEY,
      dossier TEXT NOT NULL,
      sureties TEXT
    )
  `);
  await db.execute(sql`
    ALTER TABLE user_memory ADD COLUMN IF NOT EXISTS sureties TEXT
  `);
}

export class DrizzleStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const result = await db.insert(users).values({ ...insertUser, id }).returning();
    return result[0];
  }

  async getUserMemory(userId: string): Promise<UserMemory | undefined> {
    const result = await db.select().from(userMemory).where(eq(userMemory.userId, userId)).limit(1);
    return result[0];
  }

  async upsertUserMemory(userId: string, possibilities: string, sureties: string): Promise<UserMemory> {
    const result = await db
      .insert(userMemory)
      .values({ userId, dossier: possibilities, sureties })
      .onConflictDoUpdate({
        target: userMemory.userId,
        set: { dossier: possibilities, sureties },
      })
      .returning();
    return result[0];
  }

  async deleteUserMemory(userId: string): Promise<boolean> {
    const result = await db
      .delete(userMemory)
      .where(eq(userMemory.userId, userId))
      .returning();
    return result.length > 0;
  }

  async getBotMeta(key: string): Promise<string | null> {
    await ensureBotMetaTable();
    const result = await db.select().from(botMeta).where(eq(botMeta.key, key)).limit(1);
    return result[0]?.value ?? null;
  }

  async setBotMeta(key: string, value: string): Promise<void> {
    await ensureBotMetaTable();
    await db
      .insert(botMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: botMeta.key, set: { value } });
  }
}

let botMetaTableReady = false;
async function ensureBotMetaTable(): Promise<void> {
  if (botMetaTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bot_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  botMetaTableReady = true;
}

export const storage = new DrizzleStorage();
