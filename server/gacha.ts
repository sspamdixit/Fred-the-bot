import { db } from "./db";
import { waifuCollection } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { incrementPulls } from "./economy";
import { log } from "./index";

export interface GachaResult {
  characterId: number;
  name: string;
  series: string | null;
  imageUrl: string | null;
  rarity: Rarity;
  rarityStars: number;
  rarityLabel: string;
  isNew: boolean;
}

export type Rarity = "N" | "R" | "SR" | "SSR" | "UR";

const RARITY_CONFIG: Record<Rarity, { stars: number; label: string; weight: number; goldBonus: number }> = {
  N:   { stars: 1, label: "Common",     weight: 60, goldBonus: 5   },
  R:   { stars: 2, label: "Uncommon",   weight: 25, goldBonus: 15  },
  SR:  { stars: 3, label: "Rare",       weight: 10, goldBonus: 40  },
  SSR: { stars: 4, label: "Super Rare", weight: 4,  goldBonus: 100 },
  UR:  { stars: 5, label: "Legendary",  weight: 1,  goldBonus: 500 },
};

export const PULL_COST_GOLD = 100;
export const MULTI_PULL_COST_GOLD = 900;
export const MULTI_PULL_COUNT = 10;

const ANILIST_API = "https://graphql.anilist.co";

const CHARACTER_QUERY = `
  query ($page: Int) {
    Page(page: $page, perPage: 20) {
      characters(sort: FAVOURITES_DESC) {
        id
        name { full native }
        image { large medium }
        gender
        media(type: ANIME, sort: POPULARITY_DESC, perPage: 1) {
          nodes {
            title { english romaji }
          }
        }
      }
    }
  }
`;

interface AniListCharacter {
  id: number;
  name: { full: string; native?: string };
  image: { large?: string; medium?: string };
  gender?: string;
  media: { nodes: Array<{ title: { english?: string; romaji?: string } }> };
}

function rollRarity(): Rarity {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const [rarity, cfg] of Object.entries(RARITY_CONFIG) as [Rarity, typeof RARITY_CONFIG[Rarity]][]) {
    cumulative += cfg.weight;
    if (roll < cumulative) return rarity;
  }
  return "N";
}

async function fetchRandomCharacter(): Promise<AniListCharacter | null> {
  const page = Math.floor(Math.random() * 250) + 1;
  const slot = Math.floor(Math.random() * 20);
  try {
    const res = await fetch(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: CHARACTER_QUERY, variables: { page } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { Page?: { characters?: AniListCharacter[] } } };
    const chars = data.data?.Page?.characters;
    if (!chars || chars.length === 0) return null;
    return chars[slot % chars.length];
  } catch {
    return null;
  }
}

export async function pullSingle(userId: string, guildId?: string): Promise<GachaResult | null> {
  const char = await fetchRandomCharacter();
  if (!char) return null;

  const rarity = rollRarity();
  const cfg = RARITY_CONFIG[rarity];
  const seriesName = char.media.nodes[0]?.title.english ?? char.media.nodes[0]?.title.romaji ?? null;
  const imageUrl = char.image.large ?? char.image.medium ?? null;

  const existing = await db.select({ id: waifuCollection.id })
    .from(waifuCollection)
    .where(and(eq(waifuCollection.userId, userId), eq(waifuCollection.characterId, char.id)))
    .limit(1);

  await db.insert(waifuCollection).values({
    userId,
    guildId: guildId ?? null,
    characterId: char.id,
    characterName: char.name.full,
    seriesName,
    imageUrl,
    rarity,
    rarityStars: cfg.stars,
  });

  await incrementPulls(userId, 1);

  return {
    characterId: char.id,
    name: char.name.full,
    series: seriesName,
    imageUrl,
    rarity,
    rarityStars: cfg.stars,
    rarityLabel: cfg.label,
    isNew: existing.length === 0,
  };
}

export async function pullMulti(userId: string, count: number, guildId?: string): Promise<GachaResult[]> {
  const results: GachaResult[] = [];
  for (let i = 0; i < count; i++) {
    const r = await pullSingle(userId, guildId);
    if (r) results.push(r);
  }
  return results;
}

export async function getCollection(userId: string, page = 1, pageSize = 10): Promise<{ cards: typeof waifuCollection.$inferSelect[]; total: number; page: number; totalPages: number }> {
  const offset = (page - 1) * pageSize;
  const [cards, countResult] = await Promise.all([
    db.select().from(waifuCollection).where(eq(waifuCollection.userId, userId)).orderBy(desc(waifuCollection.rarityStars), desc(waifuCollection.obtainedAt)).limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(waifuCollection).where(eq(waifuCollection.userId, userId)),
  ]);
  const total = countResult[0]?.count ?? 0;
  return { cards, total, page, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function rarityStars(rarity: Rarity): string {
  return "⭐".repeat(RARITY_CONFIG[rarity].stars);
}

export function rarityEmoji(rarity: Rarity): string {
  const map: Record<Rarity, string> = { N: "⚪", R: "🔵", SR: "🟣", SSR: "🟡", UR: "🔴" };
  return map[rarity];
}

export function getRarityGoldBonus(rarity: Rarity): number {
  return RARITY_CONFIG[rarity].goldBonus;
}
