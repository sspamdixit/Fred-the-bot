# Project Overview

**Fred** is a Discord bot with a Dutch AI personality, music system (Lavalink/Shoukaku), Fred FM live radio station (Spotify playlist-driven, hosted by a Dutch DJ named Lukas), semantic memory, guild lore engine, and a React web dashboard. Built with Node.js, TypeScript, Discord.js v14, Express, Socket.IO, Drizzle ORM, and PostgreSQL.

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
- Fred has a defined Dutch character: direct, calm, culturally grounded in the Netherlands. Grew up on the internet so UK music culture and British slang are in there too, but the base layer is Dutch. Fred knows it's an AI and is unbothered by that.
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
- **Episodic memory** (`server/episodic-memory.ts`): timestamped personal moments extracted from conversations. Stored in `user_episodes` PostgreSQL table (max 20 per user per guild). Extracted in the background after messages using `gemini-2.0-flash-lite`. Injected as "things fred remembers about this person" — allows Fred to reference past events naturally (e.g. "you mentioned last Tuesday you failed your test"). Zero RAM footprint, pure DB reads per message.

## Database Schema (`shared/schema.ts`)
- `user_memory` — userId (PK), dossier text, sureties text
- `user_memories` — pgvector semantic memory (userId, guildId, content, embedding, createdAt)
- `guild_memory` — guildId (PK), lore text, updatedAt
- `user_episodes` — id serial PK, userId, guildId, episode text (≤120 chars), eventLabel (human date), createdAt. Max 20 per user per guild. Created via `CREATE TABLE IF NOT EXISTS` in `server/episodic-memory.ts`.
- `bot_meta` — key-value store for bot metadata (also stores Fred's per-guild mood state as `fred_state_<guildId>` JSON)
- Schema sync: `npm run db:push` (Drizzle)
- Both `user_memory` and `guild_memory` use `CREATE TABLE IF NOT EXISTS` for safe startup on fresh databases

## Fred FM Radio (`server/radio.ts`)
- All audio (local files, ads, DJ clips, YouTube tracks) routes through Lavalink — no `@discordjs/voice`, no UDP
- **Spotify playlist mode**: 50% of music slots pull directly from the configured Spotify playlist; 50% are discovery queries around playlist artists (artist mixes, similar-artist searches, track-level discovery). Discovery injection uses playlist-derived artist seeds only — no generic genre seeds — so the station stays on-genre.
- Playlist fetched on radio start, cached 1 hour
- Director between tracks: weighted dice roll over advert/selftalk/trackintro/trackoutro/weirdsound clip types
- Anti-repeat windows for recent tracks, YouTube URIs, and clips
- `/stop`, `/skip`, `/pause`, `/resume`, `/volume` all route to radio player when Fred FM is active

## Radio Auto-Production (`server/radio-producer.ts`)
- Gemini generates DJ script **text** posted as Discord messages in the radio text channel. AUDIO is always and only the pre-recorded Lukas clips from `radio_assets/`. No TTS. No generated voices.
- **Track commentary**: `generateTrackCommentaryText()` — 1-2 sentence Fred comment on the upcoming track, posted to the Discord text channel. Does not touch audio.
- **Top-of-hour news**: `generateNewsText()` fetches real headlines via `searchWeb`, writes a dry Fred-voiced bulletin, posted as a Discord message between tracks.
- **Listener requests**: `/radiorequest <song>` queues up to 5 requests per guild; next request slot posts a text announcement and plays the track via YouTube.

## Music System (`server/music.ts`)
- Lavalink via Shoukaku
- Now-playing embeds: Spotify-style layout, album art from Spotify Web API, live progress bar
- Autoplay, node-health watchdog, stuck/exception recovery, filter reset between tracks
- Vote-skip: majority required if 3+ in voice, instant if ≤2
- `/reconnect`: force-migrates to fresh node at same timestamp
- `/lyrics`: lyrics.ovh API, auto-detects from queue or Fred FM
- `/history`: last 20 tracks per guild session

## Fred's Voice / TTS (`server/tts.ts`)
- `/speak <text>` slash command plays text-to-speech in the user's voice channel
- Uses StreamElements Brian voice (British male, free, no API key) via direct MP3 URL
- URL format: `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=...`
- Lavalink resolves and plays the HTTP audio — no separate audio pipeline needed
- If music is already playing: TTS is inserted at the front of the queue via `addToFront`
- If no queue: joins the user's voice channel, speaks, then the auto-disconnect timer fires after 30s idle

## Intelligent Reactive DJ / Mood Engine (`server/mood-engine.ts`)
- Reads recent channel messages (via `getChannelContextText`) and heuristically scores the server vibe
- Vibes: `hype` / `chill` / `sad` / `focus` / `late-night` / `normal`; energy: `high` / `medium` / `low`
- Signals scored: hype words, sad words, focus/study words, chill words, exclamation density, UTC hour
- Returns an array of mood-appropriate YouTube search seeds (8 per vibe)
- Cached per guild+channel for 10 minutes to avoid redundant re-analysis
- **Music autoplay** (`fetchAutoplayTracks` strategy 3): when strategies 1 and 2 don't fill the count, mood seeds are used as discovery queries
- **Fred FM radio** fallback: when no Spotify credentials, `pickYouTubeTrack` uses mood seeds instead of generic genre seeds

## Emotional Intelligence Layer (`server/emotional-state.ts`)
- Per-user in-RAM emotional signal tracking (resets on restart)
- `updateUserEmotionalSignal(userId, content)` — heuristic regex classifier, 5 signal types: `celebrating`, `stressed`, `frustrated`, `negative`, `positive`. Only non-neutral signals are stored.
- `getUserEmotionalContext(userId)` — reads last 2 hours of signals, returns a brief instruction string (or null)
- Example outputs: `"speaker seems to be celebrating something"`, `"speaker has shown stress signals recently"`, `"speaker is in a good mood"`
- Called in `messageCreate` for every human message ≥10 chars
- Injected into `buildUserPrompt()` as `emotional signal:` field — present in every AI call
- Allows Fred to read the room and modulate sarcasm/tone appropriately without explicit commands

## AI Context Injection (per message) — updated
Every AI call receives:
- `emotional signal:` — from emotional state tracker (new)
- All previous fields: server, channel, speaker, roles, authority, time, voice, other active, server lore, recent chat context, replying to message

## Fred's Internal Persona States (`server/fred-state.ts`)
- 12 internal moods: `baseline`, `caffeinated`, `post_banger`, `philosophical`, `tired`, `entertained`, `grumpy`, `warm`, `nostalgic`, `distracted`, `unimpressed`, `genuinely_invested`
- Each mood has a `promptModifier` string injected into the AI system prompt via `withFredState()` — shapes tone naturally without announcement
- State stored per guild in `bot_meta` as JSON (`fred_state_<guildId>`). Tiny in-memory cache (one entry per guild, 30-min TTL, max 50 guilds)
- Updated every 2–3 hours by `initFredState()` cron: 60% time-of-day logic, 40% random selection
- Also carries a `lifeEvent` — a short sentence injected into `buildUserPrompt()` as `fred's context today: ...` (hand-curated pool of 20 entries, no extra API calls)
- `nudgeFredStateByVibe()` and `nudgeFredMood()` for reactive updates from server vibe shifts or direct events
- `initFredState()` called on bot ready for every joined guild

## AI Context Injection (per message) — full list
Every `askGemini` call builds a rich context block:
- `server:` / `channel:` / `speaker:` / `roles:` / `authority level:` / `time:` / `voice:` / `other recently active here:`
- `server lore:` — guild prose summary from `guild_memory`
- `emotional signal:` — per-user in-RAM signal (celebrating / stressed / frustrated / positive)
- `things fred remembers about this person:` — up to 5 episodic memory entries from `user_episodes`
- `fred's context today:` — Fred's current life event (from `fred-state.ts`)
- `recent chat context:` / `replying to message:` / `message:`
- System prompt is additionally wrapped with `withFredState()` (mood modifier) and `withModeOverride()` (personality mode)

## Bot Entry Points
- `server/bot.ts` — all Discord event handlers and slash/prefix command routing
- `server/index.ts` — Express server startup, database init, bot auto-start
- `server/gemini.ts` — all AI calls, context building, channel memory, passive watch, hypocrisy engine coordination
- `server/ai-settings.ts` — system prompt, capability notes, weakness notes
- `server/semantic-memory.ts` — pgvector embedding, lore search, dossier builder, hypocrisy engine
- `server/guild-memory.ts` — guild lore extraction, caching, table management
- `server/episodic-memory.ts` — timestamped personal episode extraction + retrieval (new)
- `server/fred-state.ts` — Fred's 12 internal moods, per-guild, persisted in bot_meta (new)
- `server/radio.ts` — Fred FM broadcast system
- `server/radio-producer.ts` — Gemini DJ script generation + StreamElements TTS URL production (new)
- `server/music.ts` — Lavalink music queue and helpers
- `server/tts.ts` — StreamElements TTS via Lavalink
- `server/mood-engine.ts` — server vibe analysis + music seed selection
- `server/emotional-state.ts` — per-user emotional signal tracking

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
