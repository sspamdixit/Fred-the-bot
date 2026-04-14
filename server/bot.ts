import {
  Client,
  GatewayIntentBits,
  ActivityType,
  ChannelType,
  TextChannel,
  PresenceStatusData,
  Message,
} from "discord.js";
import { log } from "./index";
import { getIO } from "./socket";
import { askGemini, askGeminiWithImage, clearUserMemorySession, getAIStats, triggerUserMemoryUpdate, type ImageData } from "./gemini";
import { buildBotProfileMessage } from "./ai-settings";
import { startQotd } from "./qotd";
import { storage } from "./storage";

export interface BotStatus {
  online: boolean;
  tag: string | null;
  avatarUrl: string | null;
  guildCount: number;
  uptimeStart: number | null;
  status: string;
  activityName: string;
  activityType: string;
  lastError: string | null;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

export interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  channels: ChannelInfo[];
}

export interface LiveAttachment {
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface LiveMessage {
  id: string;
  messageId: string;
  channelId: string;
  channelName: string;
  guildName: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  attachments: LiveAttachment[];
  timestamp: number;
}

let botState: BotStatus = {
  online: false,
  tag: null,
  avatarUrl: null,
  guildCount: 0,
  uptimeStart: null,
  status: "offline",
  activityName: "Under Maintenance!",
  activityType: "Custom",
  lastError: null,
};

let client: Client | null = null;

export function getBotStatus(): BotStatus {
  if (client && client.user) {
    return {
      ...botState,
      guildCount: client.guilds.cache.size,
    };
  }
  return botState;
}

export function getGuildsWithChannels(): GuildInfo[] {
  if (!client || !botState.online) return [];

  return client.guilds.cache.map((guild) => {
    const textChannels = guild.channels.cache
      .filter(
        (ch) =>
          ch.type === ChannelType.GuildText ||
          ch.type === ChannelType.GuildAnnouncement
      )
      .sort((a, b) => {
        const posA = (a as TextChannel).rawPosition ?? 0;
        const posB = (b as TextChannel).rawPosition ?? 0;
        return posA - posB;
      })
      .map((ch) => ({
        id: ch.id,
        name: (ch as TextChannel).name,
        type: ch.type === ChannelType.GuildAnnouncement ? "announcement" : "text",
      }));

    return {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 64 }) ?? null,
      channels: textChannels,
    };
  });
}

export async function setBotPresence(
  status: PresenceStatusData,
  activityType: string,
  activityName: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || !client.user || !botState.online) {
    return { success: false, error: "Bot is not online." };
  }

  const typeMap: Record<string, ActivityType> = {
    Playing: ActivityType.Playing,
    Watching: ActivityType.Watching,
    Listening: ActivityType.Listening,
    Competing: ActivityType.Competing,
    Streaming: ActivityType.Streaming,
    Custom: ActivityType.Custom,
  };

  const resolvedType = typeMap[activityType] ?? ActivityType.Watching;
  const trimmedActivityName = activityName.trim();

  try {
    const activities = !trimmedActivityName
      ? []
      : resolvedType === ActivityType.Custom
        ? [{ name: "Custom Status", type: ActivityType.Custom, state: trimmedActivityName }]
        : [{ name: trimmedActivityName, type: resolvedType }];

    client.user.setPresence({
      status,
      activities,
    });

    botState.status = status;
    botState.activityType = activityType;
    botState.activityName = activityName;

    log(`Presence updated: ${status} — ${activityType} ${activityName}`, "discord");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function sendMessageToChannel(
  channelId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || !botState.online) {
    return { success: false, error: "Bot is not online." };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return { success: false, error: "Channel not found or not a text channel." };
    }
    await (channel as TextChannel).send({
      content,
      allowedMentions: { parse: [] },
    });
    return { success: true };
  } catch (err: any) {
    log(`Failed to send message: ${err.message}`, "discord");
    return { success: false, error: err.message };
  }
}

export async function dispatchMessage(
  channelId: string,
  content: string,
  replyToId?: string,
  mentionUserId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || !botState.online) {
    return { success: false, error: "Bot is not online." };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return { success: false, error: "Channel not found or not a text channel." };
    }

    const textChannel = channel as TextChannel;
    const finalContent = mentionUserId
      ? `<@${mentionUserId}> ${content}`
      : content;
    const allowedMentions = mentionUserId
      ? { parse: [], users: [mentionUserId], repliedUser: false }
      : { parse: [], repliedUser: false };

    if (replyToId) {
      const targetMessage = await textChannel.messages.fetch(replyToId);
      await targetMessage.reply({
        content: finalContent,
        allowedMentions,
      });
    } else {
      await textChannel.send({
        content: finalContent,
        allowedMentions,
      });
    }

    return { success: true };
  } catch (err: any) {
    log(`Dispatch failed: ${err.message}`, "discord");
    return { success: false, error: err.message };
  }
}

const VIBE_CHECK_CHANNEL_ID = "1484056100654551133";
const VIBE_CHECK_INTERVAL_MS = 1_800_000;

async function startVibeCheck(readyClient: Client) {
  const runVibeCheck = async () => {
    try {
      const channel = await readyClient.channels.fetch(VIBE_CHECK_CHANNEL_ID);
      if (
        !channel ||
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement)
      ) {
        log("[VibeCheck] Could not fetch lounge channel.", "discord");
        return;
      }

      const textChannel = channel as TextChannel;
      const fetched = await textChannel.messages.fetch({ limit: 50 });
      const humanMessages = fetched
        .filter((m) => !m.author.bot)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      let chatSummary: string;
      if (humanMessages.size === 0) {
        chatSummary = "[no recent messages — the channel is completely dead]";
      } else {
        chatSummary = humanMessages
          .map((m) => `${m.author.username}: ${m.content}`)
          .join("\n");
      }

      const vibePrompt =
        "Analyze this chat history and describe the current mood or the stupidity of these people in one sharp, sarcastic sentence. If it's dead, mock the silence. Stay all lowercase, no emojis, be a prick.\n\n" +
        chatSummary;

      const reply = await askGemini(vibePrompt, "system", "vibe-check-internal", {});
      if (!reply) {
        log("[VibeCheck] AI returned no reply — skipping.", "discord");
        return;
      }

      await textChannel.send({
        content: reply.toLowerCase(),
        allowedMentions: { parse: [] },
      });

      log("[VibeCheck] Vibe check sent to lounge.", "discord");
    } catch (err: any) {
      log(`[VibeCheck] Error: ${err.message}`, "discord");
    }
  };

  setInterval(runVibeCheck, VIBE_CHECK_INTERVAL_MS);
  log("[VibeCheck] Background task started — fires every 30 minutes.", "discord");
}

export async function startBot() {
  if (!process.env.TOKEN) {
    log("No TOKEN found — bot will not start.", "discord");
    botState.lastError = "Missing TOKEN environment variable.";
    return;
  }

  if (client) {
    log("Destroying existing client before restarting.", "discord");
    client.destroy();
    client = null;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", (readyClient) => {
    log(`${readyClient.user.tag} is now active in the Lab.`, "discord");

    readyClient.user.setPresence({
      activities: [{ name: "Custom Status", type: ActivityType.Custom, state: "Under Maintenance!" }],
      status: "dnd",
    });

    botState = {
      online: true,
      tag: readyClient.user.tag,
      avatarUrl: readyClient.user.displayAvatarURL({ size: 256 }),
      guildCount: readyClient.guilds.cache.size,
      uptimeStart: Date.now(),
      status: "dnd",
      activityName: "Under Maintenance!",
      activityType: "Custom",
      lastError: null,
    };

    startQotd(readyClient);
    startVibeCheck(readyClient);
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;

    const io = getIO();

    const liveMsg: LiveMessage = {
      id: `${message.id}-${Date.now()}`,
      messageId: message.id,
      channelId: message.channelId,
      channelName: (message.channel as TextChannel).name ?? "unknown",
      guildName: message.guild?.name ?? "DM",
      authorId: message.author.id,
      authorName: message.author.username,
      authorAvatar: message.author.displayAvatarURL({ size: 64 }) ?? null,
      content: message.content,
      attachments: message.attachments.map((a) => ({
        name: a.name,
        url: a.url,
        contentType: a.contentType ?? null,
        size: a.size,
      })),
      timestamp: message.createdTimestamp,
    };

    if (io) {
      io.emit("liveFeed:message", liveMsg);
    }
    log(`[Live] ${liveMsg.authorName} in #${liveMsg.channelName}: ${liveMsg.content.slice(0, 60)}`, "discord");

    const isMentioned = client?.user && message.mentions.users.has(client.user.id);
    const COMMAND_PREFIX = /^[!?]bubbl\s*/i;
    const isPrefixed = COMMAND_PREFIX.test(message.content);

    // Standalone commands (no prefix/mention required)
    const rawContent = message.content.trim();
    const standaloneCmd = rawContent.toLowerCase();
    const authorDisplayName = message.member?.displayName ?? message.author.username;
    const roleNames = message.member?.roles.cache
      .filter((role) => role.name !== "@everyone")
      .map((role) => role.name) ?? [];
    const isOwner = roleNames.some((role) => role.trim().toLowerCase() === "owner") ||
      [message.author.username, authorDisplayName].some((name) => name.trim().toLowerCase() === "deliv3r");

    const sendPrivate = async (content: string) => {
      try {
        await message.author.send(content);
      } catch (err: any) {
        await message.reply({
          content: "i can't dm you. open your dms if you want dossier commands to stay private.",
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
    };

    const dossierCommand = standaloneCmd.match(/^\?(dossview|dossdelete|dosswipe)\b/);
    if (dossierCommand) {
      try {
        await message.delete();
      } catch {
      }

      if (!isOwner) {
        await sendPrivate("no. dossier commands are owner-only.");
        return;
      }

      const command = dossierCommand[1];
      const target = message.mentions.users.first();
      if (!target) {
        await sendPrivate(`usage: ?${command} @user`);
        return;
      }

      try {
        if (command === "dossview") {
          const memory = await storage.getUserMemory(target.id);
          await sendPrivate([
            `dossier for ${target.tag}:`,
            memory?.dossier?.trim() || "new user. no record.",
          ].join("\n"));
          return;
        }

        const deleted = await storage.deleteUserMemory(target.id);
        if (command === "dosswipe") {
          clearUserMemorySession(target.id);
        }

        await sendPrivate(
          command === "dosswipe"
            ? `${target.tag}'s saved dossier ${deleted ? "and live memory were wiped." : "was already empty; live memory was wiped."}`
            : `${target.tag}'s saved dossier ${deleted ? "was deleted." : "was already empty."}`,
        );
      } catch (err: any) {
        log(`[Dossier] Command failed: ${err.message}`, "discord");
        await sendPrivate(`dossier command failed: ${err.message}`);
      }
      return;
    }

    if (standaloneCmd === "?info") {
      const profileMessage = await buildBotProfileMessage();
      await message.reply({
        content: [
          "**bubbl manager** — discord bot + ai hybrid thing.",
          "",
          "what it does:",
          "- responds when you ping it or use `?bubbl <message>`",
          "- runs on groq first, then gemini, then grok via hackclub if needed",
          "- has memory per channel (last 150 messages)",
          "- streams live messages to a dashboard",
          "- lets admins control presence, send messages, and manage settings",
          "- can explain its own capabilities and weaknesses",
          "",
          profileMessage,
          "",
          "commands: `?info` `?status` `?help` `?ping` `?vibecheck`",
          "legacy aliases: `!help` and `!bubbl <anything>` still work.",
          "or just `?bubbl <anything>` to talk to it.",
        ].join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "?capabilities" || standaloneCmd === "?weaknesses") {
      await message.reply({
        content: await buildBotProfileMessage(),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "?status") {
      const s = getAIStats();
      const uptime = botState.uptimeStart
        ? Math.floor((Date.now() - botState.uptimeStart) / 1000)
        : null;
      const uptimeStr = uptime != null
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
        : "unknown";
      const totalTokens = s.totalTokens.gemini + s.totalTokens.groq + s.totalTokens.hackclub;

      await message.reply({
        content: [
          "**bot status**",
          `online: ${botState.online ? "yes" : "no"}`,
          `uptime: ${uptimeStr}`,
          `servers: ${botState.guildCount}`,
          "",
          "**ai usage (this session)**",
          `last provider: ${s.lastUsedProvider ?? "none yet"}`,
          `last model: ${s.lastUsedModel ?? "none yet"}`,
          `total requests: ${s.totalRequests}`,
          `total tokens: ${totalTokens.toLocaleString()} (gemini: ${s.totalTokens.gemini.toLocaleString()} | groq: ${s.totalTokens.groq.toLocaleString()} | grok: ${s.totalTokens.hackclub.toLocaleString()})`,
        ].join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "?help" || standaloneCmd === "!help") {
      await message.reply({
        content: [
          "**commands**",
          "`?info` — what this bot is and does",
          "`?status` — current model, token usage, uptime",
          "`?help` — this list (`!help` still works too)",
          "`?ping` — check if the bot is alive",
          "`?vibecheck` — analyze the current channel vibe",
          "`?bubbl <message>` — talk to the ai (`!bubbl <message>` still works too)",
          `or just ping <@${client?.user?.id}> with your message`,
        ].join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "?ping") {
      const start = Date.now();
      const sent = await message.reply({
        content: "pong.",
        allowedMentions: { parse: [], repliedUser: false },
      });
      const latency = Date.now() - start;
      const wsLatency = client?.ws.ping ?? -1;
      await sent.edit(`pong. roundtrip: **${latency}ms** | ws: **${wsLatency}ms**`);
      return;
    }

    if (standaloneCmd === "?vibecheck") {
      try {
        await (message.channel as TextChannel).sendTyping();
        const fetched = await (message.channel as TextChannel).messages.fetch({ limit: 50 });
        const humanMessages = fetched
          .filter((m) => !m.author.bot)
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let chatSummary: string;
        if (humanMessages.size === 0) {
          chatSummary = "[no recent messages — the channel is completely dead]";
        } else {
          chatSummary = humanMessages
            .map((m) => `${m.author.username}: ${m.content}`)
            .join("\n");
        }

        const vibePrompt =
          "Analyze this chat history and describe the current mood or the stupidity of these people in one sharp, sarcastic sentence. If it's dead, mock the silence. Stay all lowercase, no emojis, be a prick.\n\n" +
          chatSummary;

        const reply = await askGemini(vibePrompt, "system", "vibe-check-internal", {});
        if (reply) {
          await message.reply({
            content: reply.toLowerCase(),
            allowedMentions: { parse: [], repliedUser: false },
          });
        }
      } catch (err: any) {
        log(`[VibeCheck] Command error: ${err.message}`, "discord");
      }
      return;
    }

    if ((isMentioned || isPrefixed) && client?.user) {
      let cleanContent = message.content;

      if (isMentioned) {
        cleanContent = cleanContent
          .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
          .replace(/@bubbl\s*manager/gi, "");
      }

      if (isPrefixed) {
        cleanContent = cleanContent.replace(COMMAND_PREFIX, "");
      }

      cleanContent = cleanContent.trim();

      const SUPPORTED_MEDIA_TYPES = [
        "image/png", "image/jpeg", "image/webp", "image/gif",
        "video/mp4", "video/mpeg", "video/webm", "video/quicktime",
        "video/mov", "video/avi", "video/3gpp", "video/x-flv", "video/wmv",
      ];
      const SUPPORTED_MEDIA_EXTS = [
        ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".mp4", ".mpeg", ".webm", ".mov", ".avi", ".mkv", ".3gp",
      ];
      const MAX_INLINE_BYTES = 20 * 1024 * 1024;

      const mimeFromExt = (name: string): string => {
        const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
        const map: Record<string, string> = {
          ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg", ".webp": "image/webp",
          ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
          ".avi": "video/x-msvideo", ".mkv": "video/webm",
          ".3gp": "video/3gpp", ".mpeg": "video/mpeg",
        };
        return map[ext] ?? "application/octet-stream";
      };

      // Detect media — wrapped in try-catch so any discord.js edge case can't
      // silently kill the entire handler before we even try to respond.
      let hasMedia = false;
      let mediaAttachments = message.attachments.filter(() => false);
      const tenorMediaUrls: string[] = [];
      try {
        mediaAttachments = message.attachments.filter((att) => {
          const ct = att.contentType?.split(";")[0].trim().toLowerCase() ?? "";
          const ext = att.name ? att.name.slice(att.name.lastIndexOf(".")).toLowerCase() : "";
          const urlLower = att.url.toLowerCase().split("?")[0];
          return (
            SUPPORTED_MEDIA_TYPES.includes(ct) ||
            SUPPORTED_MEDIA_EXTS.includes(ext) ||
            SUPPORTED_MEDIA_EXTS.some((e) => urlLower.endsWith(e))
          );
        });

        // Tenor / gifv embeds — Discord wraps these as embeds, not attachments.
        // Use embed.data.type because Discord.js v14 Embed class has no .type getter.
        for (const embed of message.embeds) {
          const embedType = (embed as any).data?.type ?? (embed as any).type;
          if (embedType === "gifv") {
            const url = embed.video?.url ?? embed.thumbnail?.url;
            if (url) tenorMediaUrls.push(url);
          }
        }

        hasMedia = mediaAttachments.size > 0 || tenorMediaUrls.length > 0;
      } catch (mediaErr: any) {
        log(`[Gemini] Media detection error: ${mediaErr.message}`, "discord");
      }

      if (!cleanContent && !hasMedia) return;

      // Also handle ?bubbl info/status/help/ping as subcommands
      if (cleanContent) {
        const sub = cleanContent.toLowerCase();
        if (sub === "info" || sub === "status" || sub === "capabilities" || sub === "weaknesses" || sub === "help" || sub === "ping") {
          await message.reply({
            content: `use \`?${sub}\` directly instead of \`?bubbl ${sub}\`. easier.`,
            allowedMentions: { parse: [], repliedUser: false },
          });
          return;
        }
      }

      const mediaCount = mediaAttachments.size + tenorMediaUrls.length;
      log(`[Gemini] Handling from ${authorDisplayName}: ${cleanContent.slice(0, 80)}${mediaCount > 0 ? ` [+${mediaCount} media]` : ""}`, "discord");

      try {
        await (message.channel as TextChannel).sendTyping();

        if (hasMedia) {
          const mediaDataArray: ImageData[] = [];

          for (const att of mediaAttachments.values()) {
            if ((att.size ?? 0) > MAX_INLINE_BYTES) {
              log(`[Gemini] Skipping oversized attachment: ${att.name} (${att.size} bytes)`, "discord");
              continue;
            }
            try {
              // Use proxyURL — the public media proxy that doesn't require bot auth.
              // att.url is the CDN URL which requires Authorization headers for PC-uploaded files.
              const fetchUrl = att.proxyURL || att.url;
              const res = await fetch(fetchUrl, {
                headers: { "Authorization": `Bot ${process.env.TOKEN}` },
              });
              if (!res.ok) {
                log(`[Gemini] Attachment fetch failed: HTTP ${res.status} for ${att.name}`, "discord");
                continue;
              }
              const buffer = await res.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const mimeType =
                att.contentType?.split(";")[0].trim() ||
                mimeFromExt(att.name ?? "");
              mediaDataArray.push({ mimeType, data: base64 });
            } catch (fetchErr: any) {
              log(`[Gemini] Failed to fetch attachment: ${fetchErr.message}`, "discord");
            }
          }

          for (const url of tenorMediaUrls) {
            try {
              const res = await fetch(url);
              const buffer = await res.arrayBuffer();
              if (buffer.byteLength > MAX_INLINE_BYTES) {
                log(`[Gemini] Skipping oversized Tenor embed`, "discord");
                continue;
              }
              const base64 = Buffer.from(buffer).toString("base64");
              const ct = res.headers.get("content-type")?.split(";")[0].trim() ?? "video/mp4";
              mediaDataArray.push({ mimeType: ct, data: base64 });
            } catch (fetchErr: any) {
              log(`[Gemini] Failed to fetch Tenor embed: ${fetchErr.message}`, "discord");
            }
          }

          if (mediaDataArray.length > 0) {
            const reply = await askGeminiWithImage(cleanContent, authorDisplayName, message.channelId, mediaDataArray, {
              userId: message.author.id,
              roles: roleNames,
              isOwner,
            });
            if (reply) {
              await message.reply({
                content: reply,
                allowedMentions: { parse: [], repliedUser: false },
              });
              triggerUserMemoryUpdate(message.author.id);
            }
            return;
          }
        }

        const reply = await askGemini(cleanContent, authorDisplayName, message.channelId, {
          userId: message.author.id,
          roles: roleNames,
          isOwner,
        });
        if (reply) {
          await message.reply({
            content: reply,
            allowedMentions: { parse: [], repliedUser: false },
          });
          triggerUserMemoryUpdate(message.author.id);
        }
      } catch (err: any) {
        log(`[Gemini] Failed to reply: ${err.message}`, "discord");
      }
    }
  });

  client.on("guildCreate", () => {
    if (botState.online) {
      botState.guildCount = client?.guilds.cache.size ?? botState.guildCount;
    }
  });

  client.on("guildDelete", () => {
    if (botState.online) {
      botState.guildCount = client?.guilds.cache.size ?? botState.guildCount;
    }
  });

  client.on("shardDisconnect", (_event, shardId) => {
    log(`Shard ${shardId} disconnected from gateway.`, "discord");
    botState.online = false;
    botState.status = "offline";
  });

  client.on("shardReconnecting", (shardId) => {
    log(`Shard ${shardId} reconnecting to gateway…`, "discord");
    botState.status = "reconnecting";
  });

  client.on("shardResume", (shardId, replayedEvents) => {
    log(`Shard ${shardId} resumed (replayed ${replayedEvents} events).`, "discord");
    if (client?.user) {
      botState.online = true;
      botState.status = "online";
      botState.guildCount = client.guilds.cache.size;
      botState.lastError = null;
    }
  });

  client.on("error", (err) => {
    log(`Discord client error: ${err.message}`, "discord");
    botState.lastError = err.message;
    botState.online = false;
    botState.status = "error";
  });

  try {
    await client.login(process.env.TOKEN);
  } catch (err: any) {
    log(`Failed to login: ${err.message}`, "discord");
    botState.lastError = err.message;
    botState.online = false;
    botState.status = "error";

    const RETRY_DELAY_MS = 30_000;
    log(`Retrying login in ${RETRY_DELAY_MS / 1000}s…`, "discord");
    setTimeout(() => startBot(), RETRY_DELAY_MS);
  }
}
