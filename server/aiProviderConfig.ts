import { db } from "./db";
import { aiProviderChain, type AiProviderChainRow } from "@shared/schema";
import { asc, count } from "drizzle-orm";

export type ChainProviderKind = "gemini" | "groq" | "hackclub";

export interface ResolvedChainEntry {
  provider: ChainProviderKind;
  model: string | null;
  enabled: boolean;
  /** Resolved secret: dashboard DB value or environment fallback. */
  apiKey: string | null;
}

let cache: { entries: ResolvedChainEntry[]; at: number } | null = null;
const CACHE_TTL_MS = 3000;

export function invalidateAIProviderCache(): void {
  cache = null;
}

function envKeyFor(provider: ChainProviderKind): string | null {
  if (provider === "gemini") return process.env.GEMINI_API_KEY?.trim() ?? null;
  if (provider === "groq") return process.env.GROQ_API_KEY?.trim() ?? null;
  return process.env.HACKCLUB_API_KEY?.trim() ?? null;
}

function resolveApiKey(provider: ChainProviderKind, stored: string | null): string | null {
  const trimmed = stored?.trim();
  if (trimmed) return trimmed;
  return envKeyFor(provider);
}

export async function ensureDefaultProviderChain(): Promise<void> {
  const [row] = await db.select({ n: count() }).from(aiProviderChain);
  if ((row?.n ?? 0) > 0) return;

  await db.insert(aiProviderChain).values([
    { sortOrder: 0, provider: "gemini", model: null, apiKey: null, enabled: true },
    { sortOrder: 1, provider: "groq", model: null, apiKey: null, enabled: true },
    { sortOrder: 2, provider: "hackclub", model: null, apiKey: null, enabled: true },
  ]);
}

export async function getResolvedChain(): Promise<ResolvedChainEntry[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.entries;
  }

  await ensureDefaultProviderChain();
  const rows = await db.select().from(aiProviderChain).orderBy(asc(aiProviderChain.sortOrder));

  const entries: ResolvedChainEntry[] = rows.map((r) => ({
    provider: r.provider as ChainProviderKind,
    model: r.model,
    enabled: r.enabled,
    apiKey: resolveApiKey(r.provider as ChainProviderKind, r.apiKey),
  }));

  cache = { entries, at: now };
  return entries;
}

export interface ProviderApiRow {
  id: number;
  sortOrder: number;
  provider: ChainProviderKind;
  model: string | null;
  enabled: boolean;
  /** Masked or description; never full key. */
  keyHint: string | null;
  keySource: "db" | "env" | "none";
}

function maskKey(key: string | null | undefined): string | null {
  if (!key?.trim()) return null;
  const k = key.trim();
  if (k.length <= 4) return "····";
  return `········${k.slice(-4)}`;
}

function keySourceFor(row: AiProviderChainRow, provider: ChainProviderKind): "db" | "env" | "none" {
  if (row.apiKey?.trim()) return "db";
  if (envKeyFor(provider)) return "env";
  return "none";
}

export async function listProvidersForDashboard(): Promise<{ providers: ProviderApiRow[] }> {
  await ensureDefaultProviderChain();
  const rows = await db.select().from(aiProviderChain).orderBy(asc(aiProviderChain.sortOrder));

  const providers: ProviderApiRow[] = rows.map((r) => {
    const provider = r.provider as ChainProviderKind;
    const src = keySourceFor(r, provider);
    let keyHint: string | null;
    if (r.apiKey?.trim()) keyHint = maskKey(r.apiKey);
    else if (envKeyFor(provider)) keyHint = "········(environment)";
    else keyHint = null;

    return {
      id: r.id,
      sortOrder: r.sortOrder,
      provider,
      model: r.model,
      enabled: r.enabled,
      keyHint,
      keySource: src,
    };
  });

  return { providers };
}

export interface ProviderSaveInput {
  id?: number;
  provider: ChainProviderKind;
  model?: string | null;
  enabled: boolean;
  /** Omitted = keep previous key for this id; empty string = clear stored key (env only). */
  apiKey?: string;
}

export async function saveProviderChain(inputs: ProviderSaveInput[]): Promise<void> {
  const existing = await db.select().from(aiProviderChain);
  const byId = new Map(existing.map((r) => [r.id, r]));

  const values: {
    sortOrder: number;
    provider: string;
    model: string | null;
    apiKey: string | null;
    enabled: boolean;
  }[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const p = inputs[i];
    let apiKey: string | null;
    if (p.apiKey === undefined) {
      if (p.id != null && byId.has(p.id)) {
        apiKey = byId.get(p.id)!.apiKey;
      } else {
        apiKey = null;
      }
    } else if (p.apiKey === "") {
      apiKey = null;
    } else {
      apiKey = p.apiKey.trim() || null;
    }

    values.push({
      sortOrder: i,
      provider: p.provider,
      model: p.model?.trim() || null,
      enabled: p.enabled,
      apiKey,
    });
  }

  await db.delete(aiProviderChain);
  if (values.length > 0) {
    await db.insert(aiProviderChain).values(values);
  }

  invalidateAIProviderCache();
}
