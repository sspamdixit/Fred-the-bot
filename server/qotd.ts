import { Client, TextChannel, ChannelType, EmbedBuilder } from "discord.js";
import { desc } from "drizzle-orm";
import { log } from "./index";
import { db } from "./db";
import { qotdLog } from "@shared/schema";
import { generateForQotd } from "./gemini";

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
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

async function getLastQotdType(): Promise<"open" | "poll" | null> {
  const rows = await db
    .select({ type: qotdLog.type })
    .from(qotdLog)
    .orderBy(desc(qotdLog.sentAt))
    .limit(1);
  const t = rows[0]?.type;
  return t === "open" || t === "poll" ? t : null;
}

async function sendOpenQotd(channel: TextChannel): Promise<void> {
  const question = await generateForQotd("open");
  if (!question) {
    log("Failed to generate open QOTD — skipping.", "qotd");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: "❓ Question of the Day" })
    .setDescription(`**${question}**`)
    .setFooter({ text: "Drop your answer below ↓" })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });

  await db.insert(qotdLog).values({
    type: "open",
    question,
    messageId: msg.id,
    channelId: channel.id,
  });

  log(`Open QOTD sent → ${question.slice(0, 80)}`, "qotd");
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

  await db.insert(qotdLog).values({
    type: "poll",
    question: parsed.question,
    optionA: parsed.optionA,
    optionB: parsed.optionB,
    messageId: msg.id,
    channelId: channel.id,
  });

  log(`Poll QOTD sent → ${parsed.question.slice(0, 80)}`, "qotd");
}

async function runDailyQotd(client: Client): Promise<void> {
  const channel = await findQotdChannel(client);
  if (!channel) {
    log("Could not find a #qotd channel.", "qotd");
    return;
  }

  const lastType = await getLastQotdType();
  const nextType: "open" | "poll" = lastType === "open" ? "poll" : "open";
  log(`Running daily QOTD — type: ${nextType}`, "qotd");

  if (nextType === "open") {
    await sendOpenQotd(channel);
  } else {
    await sendPollQotd(channel);
  }
}

export function startQotd(client: Client): void {
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
