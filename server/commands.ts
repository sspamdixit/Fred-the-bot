import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { FREE_DAILY_GEMS, DAILY_GOLD_BONUS, VOTE_FREE_GEMS } from "./economy";
import { PULL_COST_GOLD, MULTI_PULL_COST_GOLD, MULTI_PULL_COUNT } from "./gacha";

export const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("pong~"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("see everything hiyori can do ♡"),

  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("talk to hiyori (costs 1 💎 gem)")
    .addStringOption((o) => o.setName("message").setDescription("what do you want to say?").setRequired(true)),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription(`claim your daily ${FREE_DAILY_GEMS} 💎 gems + ${DAILY_GOLD_BONUS} 🪙 gold`),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("check your gems and gold balance"),

  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("view a full stats card — balance, pulls, and rarest character")
    .addUserOption((o) => o.setName("user").setDescription("whose profile to view (default: yours)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("pull")
    .setDescription(`single gacha pull — costs ${PULL_COST_GOLD} 🪙 gold`),

  new SlashCommandBuilder()
    .setName("multipull")
    .setDescription(`${MULTI_PULL_COUNT}x gacha pulls — costs ${MULTI_PULL_COST_GOLD} 🪙 gold`),

  new SlashCommandBuilder()
    .setName("collection")
    .setDescription("view your character collection")
    .addIntegerOption((o) => o.setName("page").setDescription("page number").setMinValue(1).setRequired(false)),

  new SlashCommandBuilder()
    .setName("vote")
    .setDescription(`vote for hiyori on top.gg and earn ${VOTE_FREE_GEMS} 💎 bonus gems`),

  new SlashCommandBuilder()
    .setName("roast")
    .setDescription("hiyori roasts someone ♡")
    .addUserOption((o) => o.setName("target").setDescription("who to roast").setRequired(true)),

  new SlashCommandBuilder()
    .setName("rate")
    .setDescription("hiyori rates something out of 10")
    .addStringOption((o) => o.setName("thing").setDescription("what to rate").setRequired(true)),

  new SlashCommandBuilder()
    .setName("dossview")
    .setDescription("view a user's memory record (admin only)")
    .addUserOption((o) => o.setName("user").setDescription("target user").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((cmd) => cmd.toJSON());
