import {
  Client,
  GatewayIntentBits,
  ActivityType,
  ChannelType,
  TextChannel,
  PresenceStatusData,
  Message,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { SLASH_COMMANDS } from "./commands";
import { log } from "./index";
import { getIO, getLiveViewerCount } from "./socket";
import {
  askGemini,
  askGeminiWithImage,
  clearUserMemorySession,
  clearAllHistory,
  getAIStats,
  triggerUserMemoryUpdate,
  generateBotStatus,
  queuePassiveWatch,
  isPassiveWatchCandidate,
  pushChannelMessage,
  recordUserActivity,
  getChannelContextText,
  type ImageData,
} from "./gemini";
import { ensureGuildMemoryTable, tickGuildMessageCounter } from "./guild-memory";
import { getGuildSettings } from "./guild-settings";
import { queueMemoryIngestion, searchServerLore, buildUserDossier } from "./semantic-memory";
import { queueEpisodeExtraction, ensureEpisodesTable } from "./episodic-memory";
import { searchWeb, formatSearchResultsForAI, detectSearchIntent } from "./search";
import { startQotd, stopQotd } from "./qotd";
import { storage } from "./storage";
import { getBalance, deductGem, claimDaily, addGold, GEM_COST_PER_MESSAGE, FREE_DAILY_GEMS, DAILY_GOLD_BONUS, VOTE_FREE_GEMS } from "./economy";
import {
  pullSingle,
  pullMulti,
  getCollection,
  rarityStars,
  rarityEmoji,
  getRarityGoldBonus,
  PULL_COST_GOLD,
  MULTI_PULL_COST_GOLD,
  MULTI_PULL_COUNT,
  type GachaResult,
} from "./gacha";
import { getTopGGVoteUrl } from "./topgg";
import { initFredState } from "./fred-state";

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

const aiCooldowns = new Map<string, number>();
const AI_COOLDOWN_MS = 5_000;
function checkAiCooldown(userId: string): { ok: boolean; remaining: number } {
  const last = aiCooldowns.get(userId) ?? 0;
  const remaining = AI_COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) return { ok: false, remaining: Math.ceil(remaining / 1000) };
  aiCooldowns.set(userId, Date.now());
  return { ok: true, remaining: 0 };
}

let botState: BotStatus = {
  online: false,
  tag: null,
  avatarUrl: null,
  guildCount: 0,
  uptimeStart: null,
  status: "offline",
  activityName: "collecting waifus ♡",
  activityType: "Custom",
  lastError: null,
};

let client: Client | null = null;
const backgroundTimers = new Set<NodeJS.Timeout>();
let loginRetryTimer: NodeJS.Timeout | null = null;
let lastDiscordDisconnectAt: number | null = null;
let watchdogRestarting = false;

export function getBotStatus(): BotStatus {
  return { ...botState };
}

export function getGuildsWithChannels(): GuildInfo[] {
  if (!client) return [];
  return client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL(),
    channels: g.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({ id: c.id, name: c.name, type: "text" })),
  }));
}

export async function sendMessageToChannel(channelId: string, content: string): Promise<{ success: boolean; error?: string }> {
  if (!client) return { success: false, error: "Bot not connected." };
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || ch.type !== ChannelType.GuildText) return { success: false, error: "Channel not found or not a text channel." };
    await (ch as TextChannel).send(content);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function setBotPresence(
  status: string,
  activityType: string,
  activityName: string
): Promise<{ success: boolean; error?: string }> {
  if (!client?.isReady()) return { success: false, error: "Bot not ready." };
  try {
    const actMap: Record<string, ActivityType> = {
      Playing: ActivityType.Playing,
      Watching: ActivityType.Watching,
      Listening: ActivityType.Listening,
      Competing: ActivityType.Competing,
      Streaming: ActivityType.Streaming,
      Custom: ActivityType.Custom,
    };
    client.user?.setPresence({
      status: status as PresenceStatusData,
      activities: [{ name: activityName, type: actMap[activityType] ?? ActivityType.Custom }],
    });
    botState.activityName = activityName;
    botState.activityType = activityType;
    botState.status = status;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function dispatchMessage(
  channelId: string,
  content: string,
  replyToId?: string,
  mentionUserId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!client) return { success: false, error: "Bot not connected." };
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || ch.type !== ChannelType.GuildText) return { success: false, error: "Not a text channel." };
    const text = mentionUserId ? `<@${mentionUserId}> ${content}` : content;
    if (replyToId) {
      const msg = await (ch as TextChannel).messages.fetch(replyToId).catch(() => null);
      if (msg) { await msg.reply(text); return { success: true }; }
    }
    await (ch as TextChannel).send(text);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Rarity embed colors ────────────────────────────────────────────────────────
const RARITY_COLORS: Record<string, number> = {
  N:   0x9E9E9E,
  R:   0x2196F3,
  SR:  0x9C27B0,
  SSR: 0xFFD700,
  UR:  0xFF1744,
};

function buildPullEmbed(result: GachaResult, goldBonus: number): EmbedBuilder {
  const color = RARITY_COLORS[result.rarity] ?? 0x9E9E9E;
  const stars = rarityStars(result.rarity as any);
  const emoji = rarityEmoji(result.rarity as any);
  const isLegendary = result.rarity === "UR";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(isLegendary ? `✨ LEGENDARY PULL ✨` : `${emoji} ${result.rarityLabel}`)
    .setDescription([
      `**${result.name}**`,
      result.series ? `*${result.series}*` : null,
      "",
      `${stars}`,
      result.isNew ? `\n🎉 **new waifu unlocked~** ♡` : `\n*(duplicate — she's already yours)*`,
    ].filter(Boolean).join("\n"))
    .addFields(
      { name: "rarity", value: `${emoji} ${result.rarityLabel} (${result.rarity})`, inline: true },
      { name: "gold bonus", value: `+${goldBonus} 🪙`, inline: true },
    )
    .setFooter({ text: "hiyori's gacha ✨" });

  if (result.imageUrl) embed.setThumbnail(result.imageUrl);
  return embed;
}

// ── Handle slash commands ─────────────────────────────────────────────────────
async function handleInteraction(interaction: any): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, guild } = interaction;
  try {
    await _handleInteraction(interaction, commandName, user, guild);
  } catch (err: any) {
    log(`Interaction error [${commandName}]: ${err?.message ?? err}`, "hiyori");
    const msg = "something went wrong on my end~ try again in a moment. ♡";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch { /* interaction token expired — nothing we can do */ }
  }
}

async function _handleInteraction(interaction: any, commandName: string, user: any, guild: any): Promise<void> {

  if (commandName === "ping") {
    await interaction.reply({ content: `pong~ 🏓 \`${client?.ws.ping ?? "?"}ms\`` });
    return;
  }

  if (commandName === "help") {
    const embed = new EmbedBuilder()
      .setColor(0xD4A1FF)
      .setTitle("hiyori's commands ✨")
      .setDescription("here's everything i can do for you, darling~ ♡")
      .addFields(
        { name: "💬 chat", value: "`/chat <message>` — talk to me (costs 1 💎)\n`@Hiyori <message>` — mention me directly" },
        { name: "💰 economy", value: "`/daily` — claim free gems & gold\n`/balance` — check your 💎 gems & 🪙 gold\n`/profile [user]` — full stats card\n`/vote` — vote for free gems on top.gg" },
        { name: "🎰 gacha", value: `\`/pull\` — 1 pull (${PULL_COST_GOLD} 🪙)\n\`/multipull\` — ${MULTI_PULL_COUNT}x pulls (${MULTI_PULL_COST_GOLD} 🪙)\n\`/collection\` — your waifu collection` },
        { name: "✨ fun", value: "`/roast <user>` — i'll roast them\n`/rate <thing>` — i rate it out of 10" },
        { name: "💎 gem info", value: `${FREE_DAILY_GEMS} free gems daily · ${VOTE_FREE_GEMS} gems per vote\neach message to me costs 1 gem` },
      )
      .setFooter({ text: "hiyori ✨ collecting hearts since forever" });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (commandName === "daily") {
    await interaction.deferReply();
    const result = await claimDaily(user.id);
    if (!result.success) {
      await interaction.editReply(`you already claimed today, darling~ ♡ come back in **${result.reason}** and i'll have more ready for you.`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xD4A1FF)
      .setTitle("daily claimed~ ♡")
      .setDescription(`here's your daily haul, precious~`)
      .addFields(
        { name: "💎 gems", value: `+${FREE_DAILY_GEMS} → **${result.freeGems} total**`, inline: true },
        { name: "🪙 gold", value: `+${DAILY_GOLD_BONUS} → **${result.gold} total**`, inline: true },
      )
      .setFooter({ text: "come back tomorrow for more~ ♡" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === "balance") {
    await interaction.deferReply();
    const bal = await getBalance(user.id);
    const embed = new EmbedBuilder()
      .setColor(0xD4A1FF)
      .setTitle(`${user.displayName}'s balance`)
      .addFields(
        { name: "💎 gems", value: `**${bal.totalGems}**\n(${bal.freeGems} free · ${bal.paidGems} paid)`, inline: true },
        { name: "🪙 gold", value: `**${bal.gold}**`, inline: true },
        { name: "pulls available", value: `${Math.floor(bal.gold / PULL_COST_GOLD)}x single · ${Math.floor(bal.gold / MULTI_PULL_COST_GOLD)}x multi`, inline: false },
      )
      .setFooter({ text: "claim /daily to get more ♡" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === "profile") {
    await interaction.deferReply();
    const target = interaction.options.getUser("user") ?? user;
    const member = guild ? await guild.members.fetch(target.id).catch(() => null) : null;
    const displayName = member?.displayName ?? target.displayName ?? target.username;
    const avatarUrl = target.displayAvatarURL({ size: 256 });

    const [bal, { cards: topCards, total: collectionTotal }] = await Promise.all([
      getBalance(target.id),
      getCollection(target.id, 1, 1),
    ]);

    const rarest = topCards[0] ?? null;
    const singlePulls = Math.floor(bal.gold / PULL_COST_GOLD);
    const multiPulls = Math.floor(bal.gold / MULTI_PULL_COST_GOLD);

    const rarityBadge = rarest
      ? `${rarityEmoji(rarest.rarity as any)} **${rarest.characterName}**${rarest.seriesName ? ` · *${rarest.seriesName}*` : ""} (${rarest.rarity})`
      : "none yet — try `/pull`!";

    const embed = new EmbedBuilder()
      .setColor(rarest ? (RARITY_COLORS[rarest.rarity as keyof typeof RARITY_COLORS] ?? 0xD4A1FF) : 0xD4A1FF)
      .setAuthor({ name: `${displayName}'s profile`, iconURL: avatarUrl })
      .setThumbnail(avatarUrl)
      .addFields(
        { name: "💎 gems", value: `**${bal.totalGems}** total\n${bal.freeGems} free · ${bal.paidGems} paid`, inline: true },
        { name: "🪙 gold", value: `**${bal.gold}**\n${singlePulls}x single · ${multiPulls}x multi`, inline: true },
        { name: "🎴 collection", value: `**${collectionTotal}** characters\n**${bal.totalPulls ?? 0}** total pulls`, inline: true },
        { name: "✨ rarest card", value: rarityBadge, inline: false },
      )
      .setFooter({ text: "hiyori ✨ • use /pull to expand your collection" });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === "vote") {
    const url = getTopGGVoteUrl();
    const embed = new EmbedBuilder()
      .setColor(0xFF6B9D)
      .setTitle("vote for hiyori~ ♡")
      .setDescription(`vote on top.gg to earn **${VOTE_FREE_GEMS} free gems** every 12 hours.\n\n[→ vote here](${url})`)
      .setFooter({ text: "your support means everything to me ♡" });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (commandName === "pull") {
    await interaction.deferReply();
    const bal = await getBalance(user.id);
    if (bal.gold < PULL_COST_GOLD) {
      await interaction.editReply(`not enough gold, darling~ you have **${bal.gold} 🪙** but a pull costs **${PULL_COST_GOLD} 🪙**. claim your \`/daily\` or \`/vote\` to earn more~ ♡`);
      return;
    }
    const { success, remaining } = await (async () => {
      const { deductGold } = await import("./economy");
      return deductGold(user.id, PULL_COST_GOLD);
    })();
    if (!success) {
      await interaction.editReply("something went wrong with your gold, dear~ try again.");
      return;
    }
    const result = await pullSingle(user.id, guild?.id);
    if (!result) {
      const { addGold } = await import("./economy");
      await addGold(user.id, PULL_COST_GOLD);
      await interaction.editReply("the gacha gods are being difficult right now~ try again in a moment, darling.");
      return;
    }
    const bonus = getRarityGoldBonus(result.rarity as any);
    await addGold(user.id, bonus);
    const embed = buildPullEmbed(result, bonus);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === "multipull") {
    await interaction.deferReply();
    const bal = await getBalance(user.id);
    if (bal.gold < MULTI_PULL_COST_GOLD) {
      await interaction.editReply(`not enough gold~ you have **${bal.gold} 🪙** but ${MULTI_PULL_COUNT}x pulls cost **${MULTI_PULL_COST_GOLD} 🪙**. keep claiming your \`/daily\`~ ♡`);
      return;
    }
    const { deductGold } = await import("./economy");
    const { success } = await deductGold(user.id, MULTI_PULL_COST_GOLD);
    if (!success) {
      await interaction.editReply("something went wrong~ try again, darling.");
      return;
    }
    const results = await pullMulti(user.id, MULTI_PULL_COUNT, guild?.id);
    if (results.length === 0) {
      await addGold(user.id, MULTI_PULL_COST_GOLD);
      await interaction.editReply("the gacha spirits aren't cooperating right now~ try again soon. ♡");
      return;
    }
    let totalBonus = 0;
    for (const r of results) totalBonus += getRarityGoldBonus(r.rarity as any);
    await addGold(user.id, totalBonus);

    const lines = results.map((r, i) =>
      `${i + 1}. ${rarityEmoji(r.rarity as any)} **${r.name}** — ${r.rarityLabel}${r.isNew ? " 🎉" : ""}`
    );
    const highlight = results.find((r) => r.rarity === "UR") ?? results.find((r) => r.rarity === "SSR") ?? results[results.length - 1];
    const embed = new EmbedBuilder()
      .setColor(RARITY_COLORS[highlight.rarity] ?? 0xD4A1FF)
      .setTitle(`🎰 ${MULTI_PULL_COUNT}x pull results~ ✨`)
      .setDescription(lines.join("\n"))
      .addFields(
        { name: "🪙 gold returned", value: `+${totalBonus}`, inline: true },
        { name: "🆕 new waifus", value: `${results.filter((r) => r.isNew).length}/${results.length}`, inline: true },
      )
      .setFooter({ text: "hiyori's gacha ✨" });
    if (highlight.imageUrl) embed.setThumbnail(highlight.imageUrl);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === "collection") {
    await interaction.deferReply();
    const page = interaction.options.getInteger("page") ?? 1;
    const { cards, total, totalPages } = await getCollection(user.id, page, 10);
    if (cards.length === 0 && page === 1) {
      await interaction.editReply("your collection is empty, darling~ use `/pull` to get your first waifu~ ♡");
      return;
    }
    const lines = cards.map((c, i) =>
      `${(page - 1) * 10 + i + 1}. ${rarityEmoji(c.rarity as any)} **${c.characterName}**${c.seriesName ? ` — *${c.seriesName}*` : ""}`
    );
    const embed = new EmbedBuilder()
      .setColor(0xD4A1FF)
      .setTitle(`${user.displayName}'s collection (${total} waifus~)`)
      .setDescription(lines.join("\n") || "nothing here~")
      .setFooter({ text: `page ${page} of ${totalPages} · use /collection page:N to browse~ ♡` });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === "roast") {
    const cooldown = checkAiCooldown(user.id);
    if (!cooldown.ok) {
      await interaction.reply({ content: `hold on, darling~ wait ${cooldown.remaining}s before asking again ♡`, ephemeral: true });
      return;
    }
    const target = interaction.options.getUser("target");
    if (!target) { await interaction.reply({ content: "who am i roasting~?", ephemeral: true }); return; }
    await interaction.deferReply();
    const prompt = `roast ${target.displayName} in hiyori's voice. stay in character — playful, sharp, a little theatrical. keep it under 3 sentences.`;
    const reply = await askGemini(prompt, user.displayName, `${user.id}-roast`, { guildId: guild?.id });
    await interaction.editReply(reply ?? `*hiyori stares at ${target.displayName} for exactly three seconds* ...no, i can't. it's too easy. it wouldn't be fun~`);
    return;
  }

  if (commandName === "rate") {
    const cooldown = checkAiCooldown(user.id);
    if (!cooldown.ok) {
      await interaction.reply({ content: `wait ${cooldown.remaining}s, dear~ ♡`, ephemeral: true });
      return;
    }
    const thing = interaction.options.getString("thing");
    if (!thing) { await interaction.reply({ content: "rate *what*, darling~", ephemeral: true }); return; }
    await interaction.deferReply();
    const prompt = `rate "${thing}" out of 10 in hiyori's voice. give an exact decimal score and a sharp, specific reason. stay in character.`;
    const reply = await askGemini(prompt, user.displayName, `${user.id}-rate`, { guildId: guild?.id });
    await interaction.editReply(reply ?? `${thing}... ${(Math.random() * 10).toFixed(1)}/10. i'll let you guess why.`);
    return;
  }

  if (commandName === "chat") {
    const message = interaction.options.getString("message");
    if (!message) { await interaction.reply({ content: "say something, darling~", ephemeral: true }); return; }

    const cooldown = checkAiCooldown(user.id);
    if (!cooldown.ok) {
      await interaction.reply({ content: `wait ${cooldown.remaining}s before talking to me again~ ♡`, ephemeral: true });
      return;
    }

    const bal = await getBalance(user.id);
    if (!bal.canChat) {
      await interaction.reply({
        content: "no gems left, dear~ 💎\nclaim your `/daily`, `/vote` on top.gg, or get more gems to keep talking to me~ ♡",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();
    await deductGem(user.id);
    const reply = await askGemini(message, user.displayName, user.id, { guildId: guild?.id });
    await interaction.editReply(reply ?? "...*hiyori is quiet for a moment* ♡");
    return;
  }

  if (commandName === "dossview") {
    const target = interaction.options.getUser("user");
    if (!target) { await interaction.reply({ content: "which user?", ephemeral: true }); return; }
    await interaction.deferReply({ ephemeral: true });
    const dossier = await buildUserDossier(target.id);
    await interaction.editReply(dossier ?? "no memory record found for this user.");
    return;
  }

  // Unknown command — respond so Discord doesn't show "application did not respond"
  await interaction.reply({ content: "i don't know that command~ try `/help` to see what i can do ♡", ephemeral: true });
}

// ── Slur filter ───────────────────────────────────────────────────────────────
const SLUR_PATTERN = /\b(n+i+g+[aeu]+r*s*|f+a+g+(?:g+o+t+s*)?|ch+i+n+k+s*|sp+i+c+s*|k+i+k+e+s*|w+e+t+b+a+c+k+s*|g+o+o+k+s*|r+e+t+a+r+d+(?:ed|s)?|tr+a+n+n+(?:y+|ie+s*)|c+u+n+t+s*|d+y+k+e+s*|b+e+a+n+e+r+s*|c+r+a+c+k+e+r+s*|p+a+k+i+s*|s+l+a+n+t+(?:eye+s*)?|j+i+g+a+b+o+o+s*|p+o+r+c+h+m+o+n+k+e+y+s*|s+a+m+b+o+s*|z+i+p+p+e+r+h+e+a+d+s*|h+a+j+i+s*|r+a+g+h+e+a+d+s*|s+a+n+d+n+i+g+\w*)\b/i;

function containsSlur(text: string): boolean {
  return SLUR_PATTERN.test(text);
}

// ── Handle regular messages ────────────────────────────────────────────────────
async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  const guildId = message.guild?.id;
  const channelId = message.channel.id;
  const userId = message.author.id;
  const authorName = message.member?.displayName ?? message.author.displayName;
  const content = message.content;

  // Slur filter — silent drop, no engagement
  if (containsSlur(content)) return;

  // Push to channel context
  pushChannelMessage(channelId, authorName, content, false);
  if (guildId) {
    recordUserActivity(userId, guildId);
    tickGuildMessageCounter(guildId).catch(() => {});
  }

  const mentioned = client && message.mentions.has(client.user!);
  const nameTriggered = /\bhiyori\b/i.test(content);
  const prefixTriggered = content.startsWith("?hiyori") || content.startsWith("!hiyori");

  const isDirectTrigger = mentioned || prefixTriggered;
  const isNameTrigger = nameTriggered && !mentioned && !prefixTriggered;

  // Passive watch — free, Hiyori initiates
  if (!isDirectTrigger && !isNameTrigger && isPassiveWatchCandidate(content)) {
    const guildSettings = guildId ? await getGuildSettings(guildId).catch(() => null) : null;
    queuePassiveWatch({
      messageId: message.id,
      channelId,
      guildId: guildId ?? null,
      authorId: userId,
      authorName,
      content,
      isControversial: false,
      chattiness: guildSettings?.chattiness ?? 5,
      sendReply: async (text: string) => {
        pushChannelMessage(channelId, "Hiyori", text, true);
        await message.reply(text).catch(() => {});
      },
    });
    return;
  }

  if (!isDirectTrigger && !isNameTrigger) return;

  // Rate limit
  const cooldown = checkAiCooldown(userId);
  if (!cooldown.ok) {
    if (isDirectTrigger) {
      await message.reply(`hold on~ wait ${cooldown.remaining}s, darling ♡`).catch(() => {});
    }
    return;
  }

  // Gem check
  const bal = await getBalance(userId);
  if (!bal.canChat) {
    await message.reply(
      "no gems left, dear~ 💎 claim your `/daily`, `/vote` on top.gg, or get more gems to keep talking to me~ ♡"
    ).catch(() => {});
    return;
  }

  // Deduct gem
  await deductGem(userId);

  // Build context
  const recentContext = getChannelContextText(channelId);
  const guildSettings = guildId ? await getGuildSettings(guildId).catch(() => null) : null;
  const dossierContext = await buildUserDossier(userId).catch(() => null);

  let prompt = content.replace(/<@!?\d+>/g, "").trim();
  if (prefixTriggered) prompt = prompt.replace(/^[?!]hiyori\s*/i, "").trim();

  // Image handling
  const imageAttachment = message.attachments.find((a) =>
    a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/")
  );
  let imageData: ImageData | null = null;
  if (imageAttachment && imageAttachment.contentType) {
    try {
      const r = await fetch(imageAttachment.url, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        imageData = { data: Buffer.from(buf).toString("base64"), mimeType: imageAttachment.contentType };
      }
    } catch { /* skip */ }
  }

  const authorCtx = {
    userId,
    guildId,
    guildName: message.guild?.name,
    channelName: message.channel.type === ChannelType.GuildText ? message.channel.name : "DM",
    isOwner: message.guild?.ownerId === userId,
    replyTo: message.reference?.messageId,
  };

  // Queue memory tasks
  queueMemoryIngestion(userId, authorName, content, guildId).catch(() => {});
  queueEpisodeExtraction(userId, authorName, content, guildId).catch(() => {});

  // Web search detection
  const searchIntent = detectSearchIntent(prompt);

  let contextBlock = "";
  if (dossierContext) contextBlock += `\nuser memory:\n${dossierContext}`;
  if (recentContext) contextBlock += `\nrecent chat context:\n${recentContext}`;

  let finalPrompt = contextBlock ? `${prompt}\n\n---\n${contextBlock}` : prompt;

  let reply: string | null = null;
  try {
    if (imageData) {
      reply = await askGeminiWithImage(finalPrompt, imageData, authorName, userId, authorCtx);
    } else {
      if (searchIntent) {
        const results = await searchWeb(prompt).catch(() => []);
        if (results.length > 0) {
          finalPrompt = `${prompt}\n\n[search results]:\n${formatSearchResultsForAI(results)}`;
        }
      }
      reply = await askGemini(finalPrompt, authorName, userId, authorCtx);
    }
  } catch (err: any) {
    log(`AI error: ${err.message}`, "hiyori");
  }

  if (!reply) reply = "i'm having a moment~ try again, darling. ♡";

  pushChannelMessage(channelId, "Hiyori", reply, true);

  // Trigger memory update occasionally
  triggerUserMemoryUpdate(userId, authorName, guildId).catch(() => {});

  try {
    if (reply.length <= 2000) {
      await message.reply(reply);
    } else {
      const chunks = reply.match(/.{1,1990}(\s|$)/gs) ?? [reply.slice(0, 1990)];
      for (const chunk of chunks) await message.reply(chunk.trim());
    }
  } catch (err: any) {
    log(`Reply error: ${err.message}`, "hiyori");
  }

  // Emit to dashboard
  try {
    const io = getIO();
    io?.emit("message", {
      id: Date.now().toString(),
      messageId: message.id,
      channelId,
      channelName: message.channel.type === ChannelType.GuildText ? message.channel.name : "DM",
      guildName: message.guild?.name ?? "DM",
      authorId: userId,
      authorName,
      authorAvatar: message.author.displayAvatarURL(),
      content,
      attachments: message.attachments.map((a) => ({ name: a.name, url: a.url, contentType: a.contentType, size: a.size })),
      timestamp: message.createdTimestamp,
    } satisfies LiveMessage);
  } catch { /* skip */ }
}

// ── Status shuffler ────────────────────────────────────────────────────────────
const FALLBACK_STATUSES = [
  "collecting rare waifus~ ♡",
  "pulling for that UR...",
  "watching you spend your gold~",
  "hoarding gems like a dragon ✨",
  "waiting for your `/daily`~ ♡",
  "gacha is a lifestyle~",
  "thinking about you, darling ♡",
  "running the economy~ 🪙",
];

async function startStatusShuffler(): Promise<void> {
  async function shuffle() {
    if (!client?.isReady()) return;
    let statusText: string | null = null;
    try {
      statusText = await generateBotStatus();
    } catch { /* fall through */ }
    if (!statusText) statusText = FALLBACK_STATUSES[Math.floor(Math.random() * FALLBACK_STATUSES.length)];
    client.user?.setActivity(statusText, { type: ActivityType.Custom });
    botState.activityName = statusText;
  }
  await shuffle();
  const t = setInterval(shuffle, 30 * 60 * 1000);
  backgroundTimers.add(t);
}

// ── Bot startup ────────────────────────────────────────────────────────────────
export async function startBot(): Promise<void> {
  if (watchdogRestarting) return;

  const token =
    process.env.TOKEN ??
    process.env.DISCORD_TOKEN ??
    process.env.BOT_TOKEN;

  if (!token) {
    log("No bot token set (TOKEN / DISCORD_TOKEN / BOT_TOKEN). Bot disabled.", "hiyori");
    return;
  }

  if (client) {
    try { client.destroy(); } catch { /* skip */ }
    client = null;
  }

  for (const t of backgroundTimers) clearInterval(t);
  backgroundTimers.clear();
  if (loginRetryTimer) { clearTimeout(loginRetryTimer); loginRetryTimer = null; }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once("ready", async () => {
    log(`Hiyori is online as ${client!.user?.tag}`, "hiyori");

    botState = {
      online: true,
      tag: client!.user?.tag ?? null,
      avatarUrl: client!.user?.displayAvatarURL() ?? null,
      guildCount: client!.guilds.cache.size,
      uptimeStart: Date.now(),
      status: "online",
      activityName: "collecting waifus ♡",
      activityType: "Custom",
      lastError: null,
    };

    // Register slash commands
    await registerSlashCommands();

    // Init systems
    try { await initFredState(client!); } catch { /* skip */ }
    startStatusShuffler();
    startWatchdog();
  });

  client.on("interactionCreate", handleInteraction);
  client.on("messageCreate", handleMessage);

  client.on("guildCreate", (g) => {
    botState.guildCount = client?.guilds.cache.size ?? botState.guildCount;
    log(`Joined guild: ${g.name}`, "hiyori");
  });
  client.on("guildDelete", (g) => {
    botState.guildCount = client?.guilds.cache.size ?? botState.guildCount;
    log(`Left guild: ${g.name}`, "hiyori");
  });

  client.on("disconnect", () => {
    botState.online = false;
    lastDiscordDisconnectAt = Date.now();
    log("Disconnected from Discord.", "hiyori");
  });

  client.on("error", (err) => {
    botState.lastError = err.message;
    log(`Client error: ${err.message}`, "hiyori");
  });

  try {
    await client.login(token);
  } catch (err: any) {
    botState.online = false;
    botState.lastError = err.message;
    log(`Login failed: ${err.message}`, "hiyori");
    loginRetryTimer = setTimeout(() => startBot(), 30_000);
  }
}

// ── Watchdog ───────────────────────────────────────────────────────────────────
function startWatchdog() {
  const t = setInterval(() => {
    if (!client?.isReady() && lastDiscordDisconnectAt) {
      const elapsed = Date.now() - lastDiscordDisconnectAt;
      if (elapsed > 2 * 60 * 1000 && !watchdogRestarting) {
        watchdogRestarting = true;
        log("Watchdog: reconnecting...", "hiyori");
        startBot().finally(() => { watchdogRestarting = false; });
      }
    }
  }, 30_000);
  backgroundTimers.add(t);
}

export async function registerSlashCommands(): Promise<{ ok: boolean; count?: number; error?: string }> {
  const token = process.env.TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) return { ok: false, error: "TOKEN or DISCORD_CLIENT_ID not set" };
  try {
    const rest = new REST({ version: "10" }).setToken(token);
    const data = await rest.put(Routes.applicationCommands(clientId), { body: SLASH_COMMANDS }) as any[];
    log(`Slash commands registered: ${data.length} commands`, "hiyori");
    return { ok: true, count: data.length };
  } catch (err: any) {
    log(`Slash command registration failed: ${err.message}`, "hiyori");
    return { ok: false, error: err.message };
  }
}
