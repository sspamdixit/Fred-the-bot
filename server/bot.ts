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
import { askGemini } from "./gemini";

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
    await (channel as TextChannel).send(content);
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

    if (replyToId) {
      const targetMessage = await textChannel.messages.fetch(replyToId);
      await targetMessage.reply(finalContent);
    } else {
      await textChannel.send(finalContent);
    }

    return { success: true };
  } catch (err: any) {
    log(`Dispatch failed: ${err.message}`, "discord");
    return { success: false, error: err.message };
  }
}

export async function startBot() {
  if (!process.env.TOKEN) {
    log("No TOKEN found — bot will not start.", "discord");
    botState.lastError = "Missing TOKEN environment variable.";
    return;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", () => {
    if (!client?.user) return;
    log(`${client.user.tag} is now active in the Lab.`, "discord");

    client.user.setPresence({
      activities: [{ name: "Custom Status", type: ActivityType.Custom, state: "Under Maintenance!" }],
      status: "dnd",
    });

    botState = {
      online: true,
      tag: client.user.tag,
      avatarUrl: client.user.displayAvatarURL({ size: 256 }),
      guildCount: client.guilds.cache.size,
      uptimeStart: Date.now(),
      status: "dnd",
      activityName: "Under Maintenance!",
      activityType: "Custom",
      lastError: null,
    };
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
      timestamp: message.createdTimestamp,
    };

    if (io) {
      io.emit("liveFeed:message", liveMsg);
    }
    log(`[Live] ${liveMsg.authorName} in #${liveMsg.channelName}: ${liveMsg.content.slice(0, 60)}`, "discord");

    const isMentioned = client?.user && message.mentions.users.has(client.user.id);
    const COMMAND_PREFIX = /^!bubbl\s*/i;
    const isPrefixed = COMMAND_PREFIX.test(message.content);

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
      if (!cleanContent) return;

      log(`[Gemini] Handling from ${message.author.username}: ${cleanContent.slice(0, 80)}`, "discord");

      try {
        await (message.channel as TextChannel).sendTyping();
        const reply = await askGemini(cleanContent, message.author.username);
        if (reply) {
          await message.reply(reply);
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
  }
}
