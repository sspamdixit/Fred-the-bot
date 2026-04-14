import { db } from "./db";
import { users, userMemory } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { type User, type InsertUser, type UserMemory } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUserMemory(userId: string): Promise<UserMemory | undefined>;
  upsertUserMemory(userId: string, dossier: string): Promise<UserMemory>;
}

export async function ensureUserMemoryTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT PRIMARY KEY,
      dossier TEXT NOT NULL
    )
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

  async upsertUserMemory(userId: string, dossier: string): Promise<UserMemory> {
    const result = await db
      .insert(userMemory)
      .values({ userId, dossier })
      .onConflictDoUpdate({
        target: userMemory.userId,
        set: { dossier },
      })
      .returning();
    return result[0];
  }
}

export const storage = new DrizzleStorage();
