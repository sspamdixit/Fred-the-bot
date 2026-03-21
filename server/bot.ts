import { Client, GatewayIntentBits, ActivityType } from "discord.js";
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
