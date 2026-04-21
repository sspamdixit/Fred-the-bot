import { execSync } from "child_process";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, type Client, type TextChannel } from "discord.js";
import { storage } from "./storage";
import { log } from "./index";

export const VERSION_DISMISS_BUTTON_ID = "version_dismiss";

// Major.minor is bumped manually for meaningful releases.
// Patch number is the total git commit count — auto-increments on every commit.
const VERSION_MAJOR_MINOR = "1.1";

const VERSION_OWNER_ID = "869254762015629314";
const VERSION_CHANNEL_NAME = "moderator-only";
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

  // Find a #moderator-only text channel in any guild the bot is in.
  let target: TextChannel | null = null;
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === VERSION_CHANNEL_NAME,
    ) as TextChannel | undefined;
    if (channel) {
      target = channel;
      break;
    }
  }

  if (!target) {
    log(`[Version] No #${VERSION_CHANNEL_NAME} channel found in any guild — skipping announcement.`, "discord");
    return;
  }

  // Prepend an owner mention so the message is addressed to (and pings) the owner.
  // Discord doesn't support per-message visibility for non-interaction posts; channel
  // permissions on #moderator-only are what restrict who can see this.
  const mentionedPayload = `<@${VERSION_OWNER_ID}>\n${payload}`;

  try {
    await target.send({
      content: mentionedPayload,
      components: [dismissRow],
      allowedMentions: { users: [VERSION_OWNER_ID] },
    });
    log(`[Version] Posted update for ${commit.shortHash} in #${target.name} (${target.guild.name}).`, "discord");
  } catch (err: any) {
    log(`[Version] Failed to post update in #${target.name}: ${err.message} (code=${err.code ?? "?"})`, "discord");
    return;
  }

  try {
    await storage.setBotMeta(META_KEY, commit.hash);
  } catch (err: any) {
    log(`[Version] Failed to persist last announced commit: ${err.message}`, "discord");
  }
}
