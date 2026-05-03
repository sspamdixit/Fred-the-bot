import { db } from "./db";
import { users, userMemory, botMeta, savedPlaylists, playlistTracks } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { type User, type InsertUser, type UserMemory, type SavedPlaylist, type PlaylistTrack } from "@shared/schema";
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
  // Playlists
  getPlaylists(userId: string, guildId: string): Promise<SavedPlaylist[]>;
  getPlaylist(userId: string, guildId: string, name: string): Promise<SavedPlaylist | undefined>;
  createPlaylist(userId: string, guildId: string, name: string): Promise<SavedPlaylist>;
  deletePlaylist(userId: string, guildId: string, name: string): Promise<boolean>;
  getPlaylistTracks(playlistId: number): Promise<PlaylistTrack[]>;
  setPlaylistTracks(playlistId: number, tracks: Omit<PlaylistTrack, "id" | "playlistId">[]): Promise<void>;
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

export async function ensurePlaylistTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS saved_playlists (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id SERIAL PRIMARY KEY,
      playlist_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      encoded TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      uri TEXT NOT NULL,
      duration INTEGER NOT NULL,
      artwork_url TEXT
    )
  `);
}

let playlistTablesReady = false;
async function ensurePlaylistTablesOnce(): Promise<void> {
  if (playlistTablesReady) return;
  await ensurePlaylistTables();
  playlistTablesReady = true;
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

  // ── Playlists ─────────────────────────────────────────────────────────────

  async getPlaylists(userId: string, guildId: string): Promise<SavedPlaylist[]> {
    await ensurePlaylistTablesOnce();
    return db
      .select()
      .from(savedPlaylists)
      .where(and(eq(savedPlaylists.userId, userId), eq(savedPlaylists.guildId, guildId)));
  }

  async getPlaylist(userId: string, guildId: string, name: string): Promise<SavedPlaylist | undefined> {
    await ensurePlaylistTablesOnce();
    const result = await db
      .select()
      .from(savedPlaylists)
      .where(
        and(
          eq(savedPlaylists.userId, userId),
          eq(savedPlaylists.guildId, guildId),
          eq(savedPlaylists.name, name),
        ),
      )
      .limit(1);
    return result[0];
  }

  async createPlaylist(userId: string, guildId: string, name: string): Promise<SavedPlaylist> {
    await ensurePlaylistTablesOnce();
    const result = await db
      .insert(savedPlaylists)
      .values({ userId, guildId, name })
      .returning();
    return result[0];
  }

  async deletePlaylist(userId: string, guildId: string, name: string): Promise<boolean> {
    await ensurePlaylistTablesOnce();
    const playlist = await this.getPlaylist(userId, guildId, name);
    if (!playlist) return false;
    await db.delete(playlistTracks).where(eq(playlistTracks.playlistId, playlist.id));
    const result = await db
      .delete(savedPlaylists)
      .where(eq(savedPlaylists.id, playlist.id))
      .returning();
    return result.length > 0;
  }

  async getPlaylistTracks(playlistId: number): Promise<PlaylistTrack[]> {
    await ensurePlaylistTablesOnce();
    return db
      .select()
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .orderBy(playlistTracks.position);
  }

  async setPlaylistTracks(
    playlistId: number,
    tracks: Omit<PlaylistTrack, "id" | "playlistId">[],
  ): Promise<void> {
    await ensurePlaylistTablesOnce();
    await db.delete(playlistTracks).where(eq(playlistTracks.playlistId, playlistId));
    if (!tracks.length) return;
    await db.insert(playlistTracks).values(
      tracks.map((t) => ({ ...t, playlistId })),
    );
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
