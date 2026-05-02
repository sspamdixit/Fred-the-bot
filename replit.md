# Project Overview

**Fred** is a Discord bot with a British AI personality, music system (Lavalink/Shoukaku), Fred FM live radio station (Spotify playlist-driven, hosted by a Dutch DJ named Lukas), semantic memory, guild lore engine, and a React web dashboard. Built with Node.js, TypeScript, Discord.js v14, Express, Socket.IO, Drizzle ORM, and PostgreSQL.

# Replit Configuration

- Runtime: Node.js 20
- Main development command: `npm run dev`
- Web server port: `5000`
- Production build command: `npm run build`
- Production run command: `node ./dist/index.cjs`
- Database schema sync command: `npm run db:push`

# Architecture Notes

## Core Structure
- Server code: `server/`
- Client code: `client/`
- Shared schema/types: `shared/`
- Static production assets: `dist/public` (after build)
- API routes mounted under `/api`, protected by dashboard auth where appropriate
- Secrets (Discord token, Spotify credentials, API keys) read from environment variables — never committed

## Personality & Identity
- Fred has a defined British character: cultural calibration, references, and swearing style are all grounded in UK internet culture. Fred knows it's an AI and is unbothered by that.
- Lukas is the Dutch radio DJ who handles Fred FM chatter and track introductions. Fred and Lukas coexist with a professionally tolerant dynamic.
- Fred has specific music opinions (respects grime, garage, drum and bass, hip-hop with craft; finds acoustic covers of hip-hop tracks specifically offensive).
- Emotional range: default dry sarcasm, rare genuine amusement (goes quieter), late-night honesty, secret community pride, distinct annoyance register.
- All personality is defined in `server/ai-settings.ts` (`DEFAULT_SYSTEM_INSTRUCTIONS`).

## AI Context Injection (per message)
Every AI call (`askGemini`, `askGeminiWithImage`, passive watch, slash commands) receives a rich context block built in `server/gemini.ts` → `buildUserPrompt()`:
- `server:` — guild name + member count
- `channel:` — channel name
- `speaker:` — display name + last-seen label (e.g. "away 2h") from in-RAM `userLastSeenAt` map, updated by `recordUserActivity()` on every non-bot message
- `roles (highest → lowest):` — sorted role names
- `authority level:` — resolved as owner / moderator / developer / member
- `time:` — current UTC day and time, built by `buildTimeString()`
- `voice:` — who's in Fred's voice channel + what's playing (music queue or Fred FM), built by `buildVoiceSituation()` in `server/bot.ts`
- `other recently active here:` — up to 5 recent non-bot speakers in this channel, from `getRecentlyActiveUsers()`
- `server lore:` — guild-specific lore from `getGuildLore()` (see below)
- `recent chat context:` — last 12 channel messages from `recentChannelContext` map
- `replying to message:` — if the user replied to a message, the referenced message content

## Guild Lore System (`server/guild-memory.ts`)
- Autonomous, self-building server culture memory
- Every 45 messages per guild, an async background job (`extractGuildLore`) calls `gemini-2.0-flash-lite` to read recent channel messages and update a compact prose summary (~200 words) capturing inside jokes, recurring bits, member dynamics, beefs, shared obsessions
- Stored in `guild_memory` postgres table (guild_id PK, lore text, updated_at)
- RAM-cached per guild: 30-minute TTL, max 50 guilds, LRU eviction
- Fetched in parallel with user memory inside `askGemini` and `askGeminiWithImage` using `Promise.all`
- `ensureGuildMemoryTable()` called on bot startup
- `tickGuildMessageCounter()` called from `messageCreate` handler on every human message with content
- `getGuildLore()` exported for use in gemini.ts

## AI Model Routing
- Primary: Groq — `llama-3.1-8b-instant` → `llama-3.3-70b-versatile` → `llama-4-scout-17b` → `gpt-oss-20b` → `gpt-oss-120b`
- Secondary: Gemini — `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash-lite` → `gemini-2.0-flash`
- Tertiary: Hackclub/Grok — `x-ai/grok-4.1-fast`
- Image/video analysis: Gemini only
- Guild lore extraction: `gemini-2.0-flash-lite` (separate client in `guild-memory.ts`)
- QOTD generation: Groq

## Memory Systems
- **Short-term**: last 30 messages per channel in RAM (`recentChannelContext`), up to 150 stored. Resets on restart.
- **Long-term dossier**: per-user postgres record (`user_memory` table), up to ~200 words of personal context. Injected into every prompt.
- **Semantic memory**: every message embedded via `text-embedding-004`, stored as pgvector in `user_memories` table. Powers hypocrisy engine, `?lore`, `?dossier`.
- **Guild lore**: per-guild prose summary in `guild_memory` table. Built automatically, injected into every prompt.
- **Last-seen tracking**: in-RAM `userLastSeenAt` Map in `gemini.ts`, updated by `recordUserActivity()` on every human message. Used to compute last-seen labels in prompts.

## Database Schema (`shared/schema.ts`)
- `user_memory` — userId (PK), dossier text, sureties text
- `user_memories` — pgvector semantic memory (userId, guildId, content, embedding, createdAt)
- `guild_memory` — guildId (PK), lore text, updatedAt
- `bot_meta` — key-value store for bot metadata
- Schema sync: `npm run db:push` (Drizzle)
- Both `user_memory` and `guild_memory` use `CREATE TABLE IF NOT EXISTS` for safe startup on fresh databases

## Fred FM Radio (`server/radio.ts`)
- All audio (local files, ads, DJ clips, YouTube tracks) routes through Lavalink — no `@discordjs/voice`, no UDP
- **Spotify playlist mode**: 55% of music slots pull directly from the configured Spotify playlist; 45% are discovery queries around playlist artists
- Playlist fetched on radio start, cached 1 hour
- Director between tracks: weighted dice roll over advert/selftalk/trackintro/trackoutro/weirdsound clip types
- Anti-repeat windows for recent tracks, YouTube URIs, and clips
- DJ Lukas handles audio chatter; Fred handles text-side context
- `/stop`, `/skip`, `/pause`, `/resume`, `/volume` all route to radio player when Fred FM is active

## Music System (`server/music.ts`)
- Lavalink via Shoukaku
- Now-playing embeds: Spotify-style layout, album art from Spotify Web API, live progress bar
- Autoplay, node-health watchdog, stuck/exception recovery, filter reset between tracks
- Vote-skip: majority required if 3+ in voice, instant if ≤2
- `/reconnect`: force-migrates to fresh node at same timestamp
- `/lyrics`: lyrics.ovh API, auto-detects from queue or Fred FM
- `/history`: last 20 tracks per guild session

## Bot Entry Points
- `server/bot.ts` — all Discord event handlers and slash/prefix command routing
- `server/index.ts` — Express server startup, database init, bot auto-start
- `server/gemini.ts` — all AI calls, context building, channel memory, passive watch, hypocrisy engine coordination
- `server/ai-settings.ts` — system prompt, capability notes, weakness notes
- `server/semantic-memory.ts` — pgvector embedding, lore search, dossier builder, hypocrisy engine
- `server/guild-memory.ts` — guild lore extraction, caching, table management
- `server/radio.ts` — Fred FM broadcast system
- `server/music.ts` — Lavalink music queue and helpers

## Dashboard
- React frontend in `client/`
- Socket.IO live feed of Discord messages
- Controls: bot presence, send messages, toggle AI providers, trigger QOTD
- Diagnostics panel, dossier browser
- Low-animation dark style; polling pauses when tab is hidden

## Hosting Notes
- Render free tier optimized: progress bar throttles, album art LRU capped at 200, guild lore cache bounded at 50 guilds, dashboard polling pauses when hidden, `/health` ping every 4 minutes
- `PUBLIC_BASE_URL` required for Fred FM (auto-detected from `RENDER_EXTERNAL_URL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`)
- `pgvector` extension required for semantic memory; bot degrades gracefully if unavailable
