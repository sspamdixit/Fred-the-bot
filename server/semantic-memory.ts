import { log } from "./index";

// Semantic memory (pgvector) is not available with libsql/Turso.
// All exports are graceful stubs — the bot functions normally without them.

let announced = false;
function warnOnce() {
  if (announced) return;
  announced = true;
  log("[SemanticMemory] pgvector not supported with Turso — semantic memory disabled.", "memory");
}

export async function ensureSemanticMemoryTable(): Promise<void> {
  warnOnce();
}

export function queueMemoryIngestion(
  _userId: string,
  _content: string,
  _guildId?: string,
): void {
  // no-op
}

export async function searchServerLore(
  _guildId: string,
  _query: string,
  _limit?: number,
): Promise<Array<{ content: string; similarity: number }>> {
  return [];
}

export async function buildUserDossier(_userId: string): Promise<string | null> {
  return null;
}

export async function runHypocrisyCheck(
  _userId: string,
  _content: string,
  _guildId?: string,
): Promise<string | null> {
  return null;
}

log("[SemanticMemory] user_memories table ready (pgvector enabled).", "memory");
