import { execSync } from "child_process";
import type { Client } from "discord.js";
import { storage } from "./storage";
import { log } from "./index";

export const APP_VERSION = "1.1.0";

const VERSION_OWNER_ID = "869254762015629314";
const META_KEY = "last_announced_commit";

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
}

let cachedCommit: CommitInfo | null = null;

function readCurrentCommit(): CommitInfo | null {
  if (cachedCommit) return cachedCommit;
  try {
    const raw = execSync(
      'git log -1 --pretty=format:"%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%b"',
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const [hash, shortHash, subject, author, date, body = ""] = raw.split("\x1f");
    if (!hash) return null;
    cachedCommit = {
      hash,
      shortHash,
      subject: subject?.trim() ?? "",
      body: body?.trim() ?? "",
      author: author?.trim() ?? "",
      date: date?.trim() ?? "",
    };
    return cachedCommit;
  } catch {
    return null;
  }
}

export function getVersionString(): string {
  const commit = readCurrentCommit();
  return commit ? `v${APP_VERSION} (${commit.shortHash})` : `v${APP_VERSION}`;
}

export async function announceVersionOnStartup(client: Client): Promise<void> {
  const commit = readCurrentCommit();
  if (!commit) {
    log("[Version] No git commit info available — skipping update announcement.", "discord");
    return;
  }

  let last: string | null = null;
  try {
    last = await storage.getBotMeta(META_KEY);
  } catch (err: any) {
    log(`[Version] Failed to read last announced commit: ${err.message}`, "discord");
    return;
  }

  if (last === commit.hash) {
    log(`[Version] No update since last announcement (${commit.shortHash}).`, "discord");
    return;
  }

  const isFirstRun = last === null;
  const lines = [
    `**fred update — v${APP_VERSION}**`,
    `commit \`${commit.shortHash}\`${commit.author ? ` by ${commit.author}` : ""}`,
    "",
    `**${commit.subject || "(no subject)"}**`,
  ];
  if (commit.body) {
    const cleanBody = commit.body
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("Replit-"))
      .join("\n")
      .trim();
    if (cleanBody) {
      lines.push("", cleanBody);
    }
  }
  if (isFirstRun) {
    lines.push("", "_(versioning is now active — you'll get a ping like this every time fred is updated.)_");
  }

  let payload = lines.join("\n");
  if (payload.length > 1900) payload = payload.slice(0, 1897) + "...";

  try {
    const user = await client.users.fetch(VERSION_OWNER_ID);
    await user.send({ content: payload });
    log(`[Version] Sent update DM for ${commit.shortHash} to ${VERSION_OWNER_ID}.`, "discord");
  } catch (err: any) {
    log(`[Version] Failed to DM update notice: ${err.message}`, "discord");
    return;
  }

  try {
    await storage.setBotMeta(META_KEY, commit.hash);
  } catch (err: any) {
    log(`[Version] Failed to persist last announced commit: ${err.message}`, "discord");
  }
}
