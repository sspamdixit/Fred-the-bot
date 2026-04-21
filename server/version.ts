import { execSync } from "child_process";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from "discord.js";
import { storage } from "./storage";
import { log } from "./index";

export const VERSION_DISMISS_BUTTON_ID = "version_dismiss";

// Major.minor is bumped manually for meaningful releases.
// Patch number is the total git commit count — auto-increments on every commit.
const VERSION_MAJOR_MINOR = "1.1";

const VERSION_OWNER_ID = "869254762015629314";
const META_KEY = "last_announced_commit";

function readCommitCount(): number | null {
  try {
    const raw = execSync("git rev-list --count HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

let cachedAppVersion: string | null = null;
function computeAppVersion(): string {
  if (cachedAppVersion) return cachedAppVersion;
  const count = readCommitCount();
  cachedAppVersion = count != null ? `${VERSION_MAJOR_MINOR}.${count}` : VERSION_MAJOR_MINOR;
  return cachedAppVersion;
}

export const APP_VERSION = computeAppVersion();

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

  const dismissRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(VERSION_DISMISS_BUTTON_ID)
      .setLabel("Dismiss")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("✕"),
  );

  let user;
  try {
    user = await client.users.fetch(VERSION_OWNER_ID);
  } catch (err: any) {
    log(`[Version] Could not fetch owner user ${VERSION_OWNER_ID}: ${err.message} (code=${err.code ?? "?"})`, "discord");
    return;
  }

  try {
    const dm = await user.createDM();
    await dm.send({ content: payload, components: [dismissRow] });
    log(`[Version] Sent update DM for ${commit.shortHash} to ${user.tag ?? VERSION_OWNER_ID}.`, "discord");
  } catch (err: any) {
    const code = err.code ?? "?";
    let hint = "";
    if (code === 50007) hint = " (user has DMs disabled or doesn't share a server with the bot)";
    log(`[Version] Failed to DM update notice to ${VERSION_OWNER_ID}: ${err.message} (code=${code})${hint}`, "discord");
    return;
  }

  try {
    await storage.setBotMeta(META_KEY, commit.hash);
  } catch (err: any) {
    log(`[Version] Failed to persist last announced commit: ${err.message}`, "discord");
  }
}
