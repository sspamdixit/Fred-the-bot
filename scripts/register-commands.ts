#!/usr/bin/env npx tsx
/**
 * Standalone slash command registration script.
 * Run: npx tsx scripts/register-commands.ts
 * Run (clear all): npx tsx scripts/register-commands.ts --clear
 *
 * Requires TOKEN and DISCORD_CLIENT_ID environment variables.
 */
import { REST, Routes } from "discord.js";
import { SLASH_COMMANDS } from "../server/commands";

const token = process.env.TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error("❌  TOKEN and DISCORD_CLIENT_ID must be set in environment.");
  process.exit(1);
}

const clear = process.argv.includes("--clear");
const rest = new REST({ version: "10" }).setToken(token);

async function main() {
  if (clear) {
    console.log("🗑  Clearing ALL global slash commands…");
    await rest.put(Routes.applicationCommands(clientId!), { body: [] });
    console.log("✅  All global commands cleared. They will disappear from Discord within a few minutes.");
  } else {
    console.log(`📡  Registering ${SLASH_COMMANDS.length} slash commands globally…`);
    const data = await rest.put(Routes.applicationCommands(clientId!), { body: SLASH_COMMANDS });
    console.log(`✅  Registered ${(data as any[]).length} commands successfully.`);
    console.log("    Global commands propagate to all servers within ~1 hour.");
    console.log("    Tip: add ?guild_id=YOUR_GUILD_ID below for instant registration to one server:");
    console.log(`    Routes.applicationGuildCommands("${clientId}", "<your_guild_id>")`);
  }
}

main().catch((err) => {
  console.error("❌  Registration failed:", err.message ?? err);
  process.exit(1);
});
