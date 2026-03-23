import { randomBytes } from "crypto";

export const DASHBOARD_AUTH_HEADER = "x-dashboard-auth-token";
const AUTH_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
const MAX_ACTIVE_TOKENS = 2000;
const authTokenExpirations = new Map<string, number>();

function pruneExpiredTokens() {
  const now = Date.now();
  for (const [token, expiresAt] of authTokenExpirations.entries()) {
    if (expiresAt <= now) {
      authTokenExpirations.delete(token);
    }
  }
}

export function issueAuthToken(): string {
  pruneExpiredTokens();
  if (authTokenExpirations.size >= MAX_ACTIVE_TOKENS) {
    const oldestToken = authTokenExpirations.keys().next().value;
    if (oldestToken) {
      authTokenExpirations.delete(oldestToken);
    }
  }

  const token = randomBytes(32).toString("hex");
  authTokenExpirations.set(token, Date.now() + AUTH_TOKEN_TTL_MS);
  return token;
}

export function isAuthTokenValid(token: string): boolean {
  const expiresAt = authTokenExpirations.get(token);
  if (!expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    authTokenExpirations.delete(token);
    return false;
  }

  return true;
}
