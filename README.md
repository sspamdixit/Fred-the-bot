# fred

fred is a discord bot. he's british, he has opinions about your music taste, and he will absolutely tell you about both. he plays music, runs a live radio station with an actual dutch dj, searches the web, builds psychological profiles of your server members, and remembers everything anyone has ever said in the worst possible way.

built with too many api keys and a lavalink dependency that fred finds slightly undignified.

---

## who fred is

fred is british. this is not a bit — it's a genuine character foundation. his cultural calibration, his references, his swearing style, his mental clock: british. he knows he's an ai and is entirely unbothered by that. what makes him fred is that he emerged from uk internet culture and processes everything through that lens.

**lukas** does the radio. fred does the chat. that's the arrangement. fred finds lukas a bit too smooth — "bit of a radio voice, isn't it" — but respects the craft. they don't overlap much. if you bring up fred fm, fred will acknowledge lukas runs it with the energy of someone describing a competent colleague they'd never choose to have lunch with.

**fred's music taste** is real, not a bit:
- respects: grime, uk garage, drum and bass, hip-hop with actual craft, anything with a bassline that means business, indie/alt with genuine ideas
- will tolerate: honest pop (at least it knows what it is), classical when someone has a reason
- privately enjoys but won't fully admit: 90s/00s r&b, specific floor-fillers he pretends to be above
- finds embarrassing: acoustic covers of hip-hop tracks (specifically offensive), edm that builds to nothing, music made by algorithm and committee
- principle: craft over clout. weird over safe. honest over polished.

**emotional range** — fred isn't one flat sarcasm register:
- default: dry, sharp, sarcastic. warmth underneath if you look.
- genuinely amused (rare): goes *quieter*, not louder. one-word reactions. restraint is the tell.
- tired (late-night): fewer filters, more honest. a real question at 2am gets a more real answer.
- secretly proud of the community: never said, just lingers. engages more, roasts gentler when things are going well.
- actually annoyed: short, flat, no jokes. absence of humour is the signal.
- sincere: reserved for genuine crisis. when it happens, full commitment.

---

## what fred does (that you couldn't do yourself)

**talking shit:**
- responds to `@fred`, `?fred`, `!fred` — pick your poison
- everything works as `/slash` commands too
- **passive mode** — jumps into conversations without being @mentioned when something's worth commenting on. heuristic-based, 2-minute cooldown per channel.
- writes poems, roasts, stories, lyrics, essays
- analyzes images, videos, and tenor gifs
- `?tldr` — reads recent channel history so you don't have to, then rates the vibe
- translates to any language; replies in non-english if you write to him in it, with a smaller english line underneath
- role-based hierarchy: `owner`, `moderator`, `developer`, `member`
- slur filter: auto-delete, dm warning, mod-channel report, 10-minute timeout
- daily question of the day with discord polls at utc midnight
- ai-generated status every 30 minutes
- dead-chat detection — one follow-up if the lounge goes quiet, then stays muted until a human speaks
- personality modes (`?uwu`, `?boomer`, `?pirate`, `?nerd`, `?overlord`) applied server-wide

**fun commands:**
- `/rate <thing>` — rates anything out of 10 with a specific decimal and actual commentary
- `/8ball <question>` — magic 8-ball oracle
- `/ship <person1> <person2>` — compatibility percentage
- `/hottake [topic]` — spicy takes, topic optional
- `/compliment <user>` — backhanded
- `/debate <topic>` — fred picks a side and argues it

**intelligence — what fred knows in every message:**
fred's ai context is richer than almost any other bot. every single response is built with:
- **server identity** — server name, member count, channel name
- **speaker identity** — display name, roles sorted highest to lowest, authority level, and a **last-seen label** ("away 2h", "away 45m") so fred knows whether you've been around or just surfaced
- **current time** — utc day and time. late-night energy is different from morning energy. fred knows.
- **voice situation** — if fred is in a voice channel, he knows who's listening and what's playing
- **other recently active users** — who else has been talking in this channel lately
- **server lore** — see below

**server lore (autonomous, self-building):**
every 45 messages, fred's lore engine reads recent chat and uses ai to extract and update a compact summary of what makes this specific community unique — inside jokes, recurring bits, ongoing beefs, member dynamics, shared obsessions, defining moments. stored in postgres, cached in ram, refreshed in the background without any user action. injected into every ai prompt so fred responds like he's actually been here, not like he's meeting everyone for the first time. the lore builds itself.

**semantic memory (the hypocrisy engine):**
- every message gets embedded with gemini `text-embedding-004` and stored in postgres via `pgvector`
- **hypocrisy engine** — with a 2-minute per-user cooldown, fred finds your most semantically similar past statement. if cosine distance < 0.15 and gemini spots a contradiction, he roasts you for it.
- **stateless ingestion pipeline** — serialized queue with 120ms spacing, 480mb ram guard
- `?lore <query>` — semantic search across server history; fred summarizes the lore on any topic
- `?dossier @user` — diverse vector search builds a psychological profile from a wide sample of a user's messages

**long-term dossier memory:**
- per-user postgres record (up to ~200 words) built from meaningful personal context (struggles, relationships, health, school/work, pets, etc.)
- injected into every prompt so fred can call back to past conversations and personalise roasts
- never says "dossier" or "user record" unless you specifically ask

**fred fm (live radio broadcasting):**
- `/radio` joins your voice channel and starts a non-stop radio station run by lukas
- **everything plays through lavalink** — local files, ads, dj chatter, weird sounds, youtube tracks — single audio path, no ffmpeg, no udp, works on render free tier
- **spotify playlist mode**: fred fm pulls from a curated spotify playlist (`FRED_FM_PLAYLIST` env var). 55% of music slots pick directly from the playlist; 45% are discovery tracks from the same artists so similar songs flow naturally before, after, and between playlist tracks
- **director** between tracks rolls weighted dice: adverts, dj selftalk, track intros/outros, weird sounds
- **anti-repeat windows** — recent tracks, youtube uris, and clips never repeat
- lukas handles the chatter between tracks. fred tolerates this.
- `/stop`, `/skip`, `/pause`, `/resume`, `/volume` all work during fred fm — dedicated `/radiostop` not required

**actually knowing things:**
- `?search <query>` or ask anything that needs a working internet connection
- weather via wttr.in — live, no key needed
- crypto via coingecko — live, will not tell you whether to buy
- stocks / forex via yahoo finance — also live, also not financial advice
- general web search via duckduckgo (or brave if you have a key)

**music (the part that used to break):**
- full lavalink system: play, playtop, skip, stop, pause, resume, queue, nowplaying, volume, shuffle, loop, seek, remove, move, clear, autoplay, disconnect, reconnect
- `/lyrics [artist - title]` — lyrics for current track or specified song
- `/history` — last 20 tracks played this session
- now-playing embed: spotify-style layout, progress bar, album art from spotify web api if configured
- **autoplay** — keeps the queue going with similar tracks when it runs out
- **node-health watchdog** — polls every 15s; if a node starts dropping frames, fred migrates active players to a healthier one
- **stuck/exception recovery** — retries stalled tracks up to 3 times before skipping
- **`/reconnect`** — force-migrates to a fresh lavalink node at the same timestamp; for when a node is alive but playing at chipmunk speed
- multiple nodes with automatic failover

**the dashboard (for people who prefer clicking):**
- live message feed via socket.io
- bot stats, token usage, uptime
- control fred's presence
- send messages to any channel
- toggle ai providers on the fly
- trigger qotd manually
- browse and delete what fred remembers about your users

---

## commands

slash commands have autocomplete. prefix commands are for people who remember irc.

| command | description |
|---|---|
| `?help` / `/help` | context-aware command list — music commands appear only if you're in voice or a music channel |
| `?status` / `/status` | model, token count, uptime |
| `?ping` / `/ping` | latency |
| `?tldr` / `/tldr` | summarizes recent chat, rates the vibe |
| `?poem <topic>` / `/poem` | better than anything you'd write |
| `?roast <target>` / `/roast` | you asked for this |
| `?explain <topic>` / `/explain` | explains things |
| `?translate <lang> <text>` / `/translate` | any language |
| `?search <query>` / `/search` | live web search |
| `?fred <message>` / `/fred` | talk to fred |
| `?lore <query>` | semantic search across server history |
| `?dossier @user` | psychological profile from diverse memory sample |

fun slash commands:

| command | description |
|---|---|
| `/rate <thing>` | rates anything out of 10 |
| `/8ball <question>` | magic 8-ball in fred's voice |
| `/ship <person1> <person2>` | compatibility % |
| `/hottake [topic]` | spicy take, topic optional |
| `/compliment <user>` | backhanded |
| `/debate <topic>` | fred picks a side |

music (all have `?` prefix equivalents):

| command | description |
|---|---|
| `/play <query>` | play a song or playlist |
| `/playtop <query>` | add to front of queue |
| `/skip` | skip current track (vote-skip if 3+ in vc) |
| `/stop` | stop and disconnect (also stops fred fm) |
| `/disconnect` | leave voice without clearing queue |
| `/reconnect` | migrate to fresh lavalink node, keep position |
| `/pause` / `/resume` | pause or resume |
| `/queue` | show queue |
| `/nowplaying` | what's playing |
| `/volume <0–100>` | set volume |
| `/shuffle` | shuffle queue |
| `/loop` | cycle: off → track → queue → off |
| `/seek <time>` | seek to position (e.g. `1:30`) |
| `/remove <pos>` | remove track from queue |
| `/move <from> <to>` | reorder queue |
| `/clear` | clear queue, keep current track |
| `/autoplay [on/off]` | toggle autoplay |
| `/lyrics [artist - title]` | lyrics for current or specified track |
| `/history` | last 20 tracks this session |

fred fm:

| command | description |
|---|---|
| `/radio` | start fred fm in your voice channel |
| `/radiostop` | end broadcast and leave |

modes (designated channel only — configure `MODE_CHANNEL_ID`):

| command | what happens |
|---|---|
| `?uwu` / `/uwu` | god help you |
| `?boomer` / `/boomer` | everything was better in 1987 |
| `?pirate` / `/pirate` | arr |
| `?nerd` / `/nerd` | footnotes and citations |
| `?overlord` / `/overlord` | fred stops pretending |
| `?mode` / `/mode` | back to regular fred, who is already plenty |

owner-only (response dm'd for privacy):

| command | what it does |
|---|---|
| `?dossview @user` / `/dossview` | view fred's dossier on a user |
| `?dossdelete @user` / `/dossdelete` | delete persisted dossier |
| `?dosswipe @user` / `/dosswipe` | delete dossier + live session memory |

---

## ai stack

fred tries these in order until one works:

1. **groq** — fast. `llama-3.1-8b-instant` first, escalates to `llama-3.3-70b-versatile`, `llama-4-scout-17b`, `gpt-oss-20b`, `gpt-oss-120b`
2. **gemini** — `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash-lite` → `gemini-2.0-flash`
3. **hackclub / grok** — last resort. `x-ai/grok-4.1-fast` via ai.hackclub.com. it's free.

image/video analysis is gemini only. if gemini is down, fred pretends he can't see.

guild lore extraction and hypocrisy engine embeddings also require gemini. without `GEMINI_API_KEY`, the semantic memory systems won't work.

---

## env vars

| var | required | notes |
|---|---|---|
| `TOKEN` | yes | discord bot token |
| `GROQ_API_KEY` | yes | groq — the main brain |
| `GEMINI_API_KEY` | strongly recommended | without this: no vision, no memory embeddings, no hypocrisy engine, no `?lore`, no `?dossier`, no guild lore |
| `HACKCLUB_API_KEY` | optional | grok fallback |
| `DATABASE_URL` | yes | postgres — fred needs somewhere to store his grievances |
| `ENABLE_BOT` | optional | `true` to auto-start. default off. |
| `DASHBOARD_PASSWORD` | optional | locks the dashboard |
| `DASHBOARD_ORIGIN` | optional | tighten cors |
| `MODE_CHANNEL_ID` | optional | which channel can run mode commands |
| `BRAVE_SEARCH_API_KEY` | optional | better general search. 2000 free/month. |
| `LAVALINK_NODES` | optional | json array of `{url, auth, secure}` to override public nodes |
| `LAVALINK_URL` / `LAVALINK_AUTH` / `LAVALINK_SECURE` | optional | quick single-node override |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional | enables spotify playlist mode for fred fm and album art for now-playing embeds |
| `FRED_FM_PLAYLIST` | optional | spotify playlist id for fred fm. defaults to a curated list. |
| `RADIO_YT_SEEDS` | optional | comma-separated youtube search queries for fred fm discovery tracks. defaults to 28-genre curated list. |
| `PUBLIC_BASE_URL` | required for `/radio` (auto on render/replit) | absolute https url for the bot's web server — lavalink fetches local radio assets from here |
| `RENDER_EXTERNAL_URL` | optional (auto on render) | keep-alive target and public base url for fred fm |
| `PROGRESS_UPDATE_MS` | optional | progress bar tick interval in ms (default 7000) |
| `PROGRESS_UPDATES` | optional | set to `off` to disable the progress bar |
| `PORT` | optional | default `5000` |

---

## hosting on render free tier

fred survives 512mb / 0.1 cpu:
- progress bar throttles automatically when `RENDER` is detected
- album art cache is a bounded lru (200 entries)
- guild lore cache is bounded at 50 guilds with 30-minute ttl
- semantic memory embedding queue has a 480mb ram guard
- dashboard polling pauses while the tab is hidden
- `/health` ping every 4 minutes keeps the dyno from spinning down

if your dyno still falls over, that's lavalink's fault.

---

## setup

```bash
npm install
npm run db:push
npm run dev
```

`npm run db:push` creates the schema including `pgvector` extension, `user_memories` table for semantic memory, and `guild_memory` table for server lore. if your postgres can't install extensions, the semantic memory system won't start but everything else will work.

**fred fm:** drop music files into `music_library/`. name them `Artist - Title.mp3` (or `.wav`/`.ogg`) so the presence works. radio drops live in `radio_assets/{advert,selftalk,trackintro,trackoutro,weirdsound}/` — a starter pack ships with the repo.

production:

```bash
npm run build
npm start
```

---

## stack

- node.js, express, typescript, socket.io
- react, vite, tailwindcss, shadcn/ui, tanstack query
- postgres + drizzle orm + **pgvector** (semantic memory + guild lore)
- discord.js v14
- groq, google generative ai (chat + `text-embedding-004` + guild lore), hackclub ai
- lavalink via shoukaku — single audio path for both `/play` and fred fm, no udp, no ffmpeg in bot process
- spotify web api (album art + fred fm playlist)
- itunes search api for album art fallback (free, no key)
