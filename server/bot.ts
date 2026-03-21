import { Client, GatewayIntentBits, ActivityType, ChannelType, TextChannel, PresenceStatusData } from "discord.js";
import { log } from "./index";

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

let botState: BotStatus = {
  online: false,
  tag: null,
  avatarUrl: null,
  guildCount: 0,
  uptimeStart: null,
  status: "offline",
  activityName: "the Archives",
  activityType: "Watching",
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

  try {
    client.user.setPresence({
      status,
      activities: activityName.trim()
        ? [{ name: activityName.trim(), type: resolvedType }]
        : [],
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
    if (!channel || channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      return { success: false, error: "Channel not found or not a text channel." };
    }
    await (channel as TextChannel).send(content);
    return { success: true };
  } catch (err: any) {
    log(`Failed to send message: ${err.message}`, "discord");
    return { success: false, error: err.message };
  }
}

export async function startBot() {
  if (!process.env.TOKEN) {
    log("No TOKEN found — bot will not start.", "discord");
    botState.lastError = "Missing TOKEN environment variable.";
    return;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("ready", () => {
    if (!client?.user) return;
    log(`${client.user.tag} is now active in the Lab.`, "discord");

    client.user.setPresence({
      activities: [{ name: "the Archives", type: ActivityType.Watching }],
      status: "online",
    });

    botState = {
      online: true,
      tag: client.user.tag,
      avatarUrl: client.user.displayAvatarURL({ size: 256 }),
      guildCount: client.guilds.cache.size,
      uptimeStart: Date.now(),
      status: "online",
      activityName: "the Archives",
      activityType: "Watching",
      lastError: null,
    };
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
