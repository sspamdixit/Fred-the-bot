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
import { askGemini, askGeminiWithImage, getAIStats, type ImageData } from "./gemini";
import { buildBotProfileMessage } from "./ai-settings";
import { startQotd } from "./qotd";

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
    const COMMAND_PREFIX = /^!bubbl\s*/i;
    const isPrefixed = COMMAND_PREFIX.test(message.content);

    // Standalone commands (no prefix/mention required)
    const rawContent = message.content.trim();
    const standaloneCmd = rawContent.toLowerCase();

    if (standaloneCmd === "!info") {
      const profileMessage = await buildBotProfileMessage();
      await message.reply({
        content: [
          "**bubbl manager** — discord bot + ai hybrid thing.",
          "",
          "what it does:",
          "- responds when you ping it or use `!bubbl <message>`",
          "- runs on gemini first, falls back to groq, then grok via hackclub if needed",
          "- has memory per channel (last 150 messages)",
          "- streams live messages to a dashboard",
          "- lets admins control presence, send messages, and manage settings",
          "- can explain its own capabilities and weaknesses",
          "",
          profileMessage,
          "",
          "commands: `!info` `!status` `!capabilities` `!weaknesses` `!help` `!ping` `!vibecheck`",
          "or just `!bubbl <anything>` to talk to it.",
        ].join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "!capabilities" || standaloneCmd === "!weaknesses") {
      await message.reply({
        content: await buildBotProfileMessage(),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "!status") {
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

    if (standaloneCmd === "!help") {
      await message.reply({
        content: [
          "**commands**",
          "`!info` — what this bot is and does",
          "`!status` — current model, token usage, uptime",
          "`!capabilities` — what the bot can do",
          "`!weaknesses` — what the bot is bad at / cannot do",
          "`!help` — this list",
          "`!ping` — check if the bot is alive",
          "`!vibecheck` — analyze the current channel vibe",
          "`!bubbl <message>` — talk to the ai",
          `or just ping <@${client?.user?.id}> with your message`,
        ].join("\n"),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (standaloneCmd === "!ping") {
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

    if (standaloneCmd === "!vibecheck") {
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

      const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
      const SUPPORTED_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

      const imageAttachments = message.attachments.filter((att) => {
        const ct = att.contentType?.split(";")[0].trim().toLowerCase() ?? "";
        const ext = att.name
          ? att.name.slice(att.name.lastIndexOf(".")).toLowerCase()
          : "";
        return SUPPORTED_IMAGE_TYPES.includes(ct) || SUPPORTED_IMAGE_EXTS.includes(ext);
      });

      if (!cleanContent && imageAttachments.size === 0) return;

      // Also handle !bubbl info/status/help/ping as subcommands
      if (cleanContent) {
        const sub = cleanContent.toLowerCase();
        if (sub === "info" || sub === "status" || sub === "capabilities" || sub === "weaknesses" || sub === "help" || sub === "ping") {
          await message.reply({
            content: `use \`!${sub}\` directly instead of \`!bubbl ${sub}\`. easier.`,
            allowedMentions: { parse: [], repliedUser: false },
          });
          return;
        }
      }

      const authorDisplayName = message.member?.displayName ?? message.author.username;
      const roleNames = message.member?.roles.cache
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name) ?? [];
      const isOwner = roleNames.some((role) => role.trim().toLowerCase() === "owner") ||
        [message.author.username, authorDisplayName].some((name) => name.trim().toLowerCase() === "deliv3r");

      log(`[Gemini] Handling from ${authorDisplayName}: ${cleanContent.slice(0, 80)}${imageAttachments.size > 0 ? ` [+${imageAttachments.size} image(s)]` : ""}`, "discord");

      try {
        await (message.channel as TextChannel).sendTyping();

        if (imageAttachments.size > 0) {
          const imageDataArray: ImageData[] = [];
          for (const att of imageAttachments.values()) {
            try {
              const res = await fetch(att.url);
              const buffer = await res.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const mimeType = att.contentType?.split(";")[0].trim() ?? "image/png";
              imageDataArray.push({ mimeType, data: base64 });
            } catch (fetchErr: any) {
              log(`[Gemini] Failed to fetch image attachment: ${fetchErr.message}`, "discord");
            }
          }

          if (imageDataArray.length > 0) {
            const reply = await askGeminiWithImage(cleanContent, authorDisplayName, message.channelId, imageDataArray, {
              roles: roleNames,
              isOwner,
            });
            if (reply) {
              await message.reply({
                content: reply,
                allowedMentions: { parse: [], repliedUser: false },
              });
            }
            return;
          }
        }

        const reply = await askGemini(cleanContent, authorDisplayName, message.channelId, {
          roles: roleNames,
          isOwner,
        });
        if (reply) {
          await message.reply({
            content: reply,
            allowedMentions: { parse: [], repliedUser: false },
          });
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
