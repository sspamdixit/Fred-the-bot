import { db } from "./db";
import { botAiSettings, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { type User, type InsertUser, type BotAiSettings, type InsertBotAiSettings } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getBotAiSettings(id: string): Promise<BotAiSettings | undefined>;
  upsertBotAiSettings(settings: InsertBotAiSettings): Promise<BotAiSettings>;
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

  async getBotAiSettings(id: string): Promise<BotAiSettings | undefined> {
    const result = await db.select().from(botAiSettings).where(eq(botAiSettings.id, id)).limit(1);
    return result[0];
  }

  async upsertBotAiSettings(settings: InsertBotAiSettings): Promise<BotAiSettings> {
    const result = await db
      .insert(botAiSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: botAiSettings.id,
        set: {
          systemInstructions: settings.systemInstructions,
          capabilities: settings.capabilities,
          weaknesses: settings.weaknesses,
        },
      })
      .returning();
    return result[0];
  }
}

export const storage = new DrizzleStorage();
