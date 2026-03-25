import { Client, TextChannel, ChannelType, EmbedBuilder, Role } from "discord.js";
import { log } from "./index";
import { generateForQotd } from "./gemini";

function findQotdPingRole(channel: TextChannel): Role | null {
  return channel.guild.roles.cache.find(
    (r) => r.name.toLowerCase() === "qotd ping",
  ) ?? null;
}

function findQotdTalkChannel(channel: TextChannel): TextChannel | null {
  const found = channel.guild.channels.cache.find(
    (ch) =>
      (ch.name === "qotd-talk" || ch.name === "qotd talk") &&
      ch.type === ChannelType.GuildText,
  );
  return (found as TextChannel) ?? null;
}

async function sendQotdFollowUp(channel: TextChannel): Promise<void> {
  const pingRole = findQotdPingRole(channel);
  const talkChannel = findQotdTalkChannel(channel);

  const pingPart = pingRole ? `<@&${pingRole.id}>` : null;
  const talkPart = talkChannel ? ` Talk about it in <#${talkChannel.id}>!` : "";

  if (!pingPart && !talkPart) return;

  await channel.send({ content: `${pingPart ?? ""}${talkPart}`.trim() });
}

interface QotdEntry {
  type: "open" | "poll";
  question: string;
  optionA?: string;
  optionB?: string;
  sentAt: string;
  messageId: string;
  channelId: string;
}

let _lastEntry: QotdEntry | null = null;

export function getQotdStatus(): {
  last: QotdEntry | null;
  nextType: "open" | "poll";
  nextAt: string;
} {
  const nextType: "open" | "poll" = _lastEntry?.type === "open" ? "poll" : "open";
  const now = new Date();
  const nextAt = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  )).toISOString();
  return { last: _lastEntry, nextType, nextAt };
}

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  ));
  return next.getTime() - now.getTime();
}

async function findQotdChannel(client: Client): Promise<TextChannel | null> {
  for (const guild of client.guilds.cache.values()) {
    const found = guild.channels.cache.find(
      (ch) => ch.name === "qotd" && ch.type === ChannelType.GuildText,
    );
    if (found) return found as TextChannel;
  }
  return null;
}

function findQotdRole(channel: TextChannel): Role | null {
  return channel.guild.roles.cache.find(
    (r) => r.name.toLowerCase() === "qotd",
  ) ?? null;
}

async function sendOpenQotd(channel: TextChannel): Promise<void> {
  const question = await generateForQotd("open");
  if (!question) {
    log("Failed to generate open QOTD — skipping.", "qotd");
    return;
  }

  const role = findQotdRole(channel);
  const ping = role ? `<@&${role.id}>` : null;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: "❓ Question of the Day" })
    .setDescription(`**${question}**`)
    .setFooter({ text: "Drop your answer below ↓" })
    .setTimestamp();

  const msg = await channel.send({
    content: ping ?? undefined,
    embeds: [embed],
  });

  _lastEntry = {
    type: "open",
    question,
    sentAt: new Date().toISOString(),
    messageId: msg.id,
    channelId: channel.id,
  };

  log(`Open QOTD sent → ${question.slice(0, 80)}`, "qotd");
  await sendQotdFollowUp(channel);
}

async function sendPollQotd(channel: TextChannel): Promise<void> {
  const raw = await generateForQotd("poll");
  if (!raw) {
    log("Failed to generate poll QOTD — skipping.", "qotd");
    return;
  }

  let parsed: { question: string; optionA: string; optionB: string };
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    log(`Poll JSON parse failed: ${raw.slice(0, 120)}`, "qotd");
    return;
  }

  if (!parsed.question || !parsed.optionA || !parsed.optionB) {
    log("Poll JSON missing required fields — skipping.", "qotd");
    return;
  }

  const role = findQotdRole(channel);
  const ping = role ? `<@&${role.id}>` : null;

  if (ping) {
    await channel.send({ content: ping });
  }

  const msg = await channel.send({
    poll: {
      question: { text: parsed.question },
      answers: [
        { text: parsed.optionA },
        { text: parsed.optionB },
      ],
      duration: 24,
      allowMultiselect: false,
    },
  });

  _lastEntry = {
    type: "poll",
    question: parsed.question,
    optionA: parsed.optionA,
    optionB: parsed.optionB,
    sentAt: new Date().toISOString(),
    messageId: msg.id,
    channelId: channel.id,
  };

  log(`Poll QOTD sent → ${parsed.question.slice(0, 80)}`, "qotd");
  await sendQotdFollowUp(channel);
}

async function runDailyQotd(client: Client): Promise<void> {
  const channel = await findQotdChannel(client);
  if (!channel) {
    log("Could not find a #qotd channel.", "qotd");
    return;
  }

  const nextType: "open" | "poll" = _lastEntry?.type === "open" ? "poll" : "open";
  log(`Running daily QOTD — type: ${nextType}`, "qotd");

  if (nextType === "open") {
    await sendOpenQotd(channel);
  } else {
    await sendPollQotd(channel);
  }
}

let _botClient: Client | null = null;

export async function triggerQotdNow(): Promise<{ ok: boolean; type?: string; error?: string }> {
  if (!_botClient) return { ok: false, error: "Bot client not initialized." };
  try {
    const channel = await findQotdChannel(_botClient);
    if (!channel) return { ok: false, error: "Could not find a #qotd channel." };
    const nextType: "open" | "poll" = _lastEntry?.type === "open" ? "poll" : "open";
    if (nextType === "open") {
      await sendOpenQotd(channel);
    } else {
      await sendPollQotd(channel);
    }
    return { ok: true, type: nextType };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export function startQotd(client: Client): void {
  _botClient = client;

  const scheduleNext = () => {
    const delay = msUntilNextUtcMidnight();
    const mins = Math.round(delay / 60_000);
    log(`Next QOTD in ${mins} min (UTC 00:00)`, "qotd");

    setTimeout(async () => {
      try {
        await runDailyQotd(client);
      } catch (err: any) {
        log(`QOTD error: ${err.message}`, "qotd");
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
}
