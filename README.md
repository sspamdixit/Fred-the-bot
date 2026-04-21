# fred

fred is a discord bot. he's smarter than you, he knows it, and he will not shut up about it. he plays music, searches the web, remembers embarrassing things about your server members, and occasionally says something genuinely useful by accident.

built with way too many api keys and a concerning amount of lavalink nodes.

---

## what fred does (that you couldn't do yourself)

**talking shit:**
- responds to `@fred`, `?fred`, `!fred` — pick your poison
- everything works as `/slash` commands too because fred respects accessibility
- **passive mode** — fred jumps into conversations without being @mentioned when someone says something stupid enough to warrant a response. heuristic-based, 2-minute cooldown per channel. zero extra cost. maximum chaos.
- writes poems, roasts, stories, lyrics, essays. they're better than yours.
- generates code in any language, including ones you probably shouldn't be using
- analyzes images, videos, and tenor gifs and will tell you exactly what's wrong with them
- `?tldr` — reads recent channel history so you don't have to, then rates the vibe. spoiler: it's usually bad.
- translates to any language. if you reply to fred in a non-english language, he'll respond in that language with a smaller english translation underneath.
- remembers context per channel and per user (postgres). fred knows things about your members that they've forgotten they said.
- role-based hierarchy: `owner`, `moderator`, `developer`, `member` — because not everyone deserves to tell fred what to do
- slur filter with auto-delete, dm warning, mod-channel report, and a 10-minute timeout. fred has standards, unlike some of your members.
- daily question of the day with discord polls, posted at utc midnight, mentions the `qotd` role and redirects discussion to a `qotd-talk` channel if one exists
- ai-generated status message that changes every 30 minutes, weighted toward memes, gaming, anime, and pop culture
- dead-chat detection — fred notices when your lounge goes quiet and posts a single follow-up. if nobody bites, he stays muted until a human speaks again.
- personality modes (`?uwu`, `?boomer`, `?pirate`, `?nerd`, `?overlord`) that apply server-wide. yes, even to roasts. especially to roasts.

**actually knowing things:**
- `?search <query>` or just ask fred something that requires a working internet connection
- weather via wttr.in — real data, no key required
- crypto prices via coingecko — live, accurate, no key, will not tell you whether to buy
- stocks / commodities / forex via yahoo finance — also live, also accurate, also not financial advice
- general web search via duckduckgo html scraping — actual results from the actual web, not some stale knowledge base from 2022
- if you have a `BRAVE_SEARCH_API_KEY` lying around, fred will use that instead and be slightly more thorough about it

**music (the part that used to break, until we fixed it):**
- full lavalink music system: play, playtop, skip, stop, pause, resume, queue, nowplaying, volume, shuffle, loop, seek, remove, move, clear, autoplay, disconnect, reconnect
- `/play` and `/playtop` have autocomplete so you don't have to spell correctly
- now-playing embed shows track title, artist, square album art, and a progress bar that updates every few seconds
- album art is matched intelligently: itunes search results are scored by token overlap on both title (60%) and artist (40%), and only used if confidence is above a threshold. otherwise fred falls back to the source thumbnail. **no more random album covers from a different song that happened to share a word.**
- album art cache is a bounded lru (200 entries) so memory stays predictable on tiny hosts
- **autoplay** — when the queue runs out, fred fetches similar tracks from youtube/soundcloud and keeps the vibe going. user-queued songs can resurface; only autoplay-fetched tracks are excluded from rediscovery so you don't loop the same five suggestions forever.
- **node-health watchdog** — polls every 15s. if a lavalink node piles up cpu penalties or starts dropping audio frames for 30s straight, fred auto-migrates active players to a healthier node. has a 2-min cooldown and only migrates if the alternative is meaningfully better.
- **stuck/exception recovery** — if a track stalls or errors mid-playback, fred retries it up to 3 times in a 90s window before giving up and skipping. no more queues silently emptying themselves.
- **`/reconnect`** (also `?reconnect` / `?rc`) — force-migrates to a fresh lavalink node and resumes the current song at the same timestamp. for when a node is technically alive but playing audio at chipmunk or doom-soundtrack speed.
- **filter reset** — lavalink filters (timescale, etc.) are cleared between tracks as defensive hygiene against weird audio artifacts
- **interactive controls** — buttons on the now-playing embed for back, play/pause, skip, stop, and ❤️ like (the like button dms you a link to the current track)
- multiple lavalink nodes with automatic failover. when one dies (and it will), fred migrates to another one mid-queue and seeks the resumed track to the same position.

**the dashboard (for people who prefer clicking):**
- live message feed via socket.io — watch fred talk in real time, feel jealous
- bot stats, token usage, uptime
- control fred's presence (status, activity, etc.)
- send messages to any channel. yes, anonymously. no, we're not responsible.
- toggle ai providers on the fly (gemini / groq / hackclub)
- trigger qotd manually when the server needs drama
- diagnostics panel that pings every external api and news feed
- browse and delete what fred remembers about your users. it's a lot.
- low-animation dark style. polls slow down or pause when the tab is hidden so it doesn't melt your render free dyno.

---

## commands

slash commands have autocomplete. prefix commands are for people who remember irc.

| command | description |
|---|---|
| `?help` / `/help` | shows commands. context-aware — music commands only appear if you're in voice or a music channel. |
| `?status` / `/status` | model, token count, uptime. a report card nobody asked for. |
| `?ping` / `/ping` | latency. fred is fast. your internet might not be. |
| `?tldr` / `/tldr` | summarizes chat. judges your server. |
| `?poem <topic>` / `/poem` | better than anything you'd write |
| `?roast <target>` / `/roast` | you asked for this |
| `?explain <topic>` / `/explain` | explains things to you slowly |
| `?translate <lang> <text>` / `/translate` | works on any language including klingon probably |
| `?search <query>` | live web search |
| `?fred <message>` / `/fred` | talk to fred directly. he'll respond. he might not be nice about it. |

music commands (all have prefix `?` equivalents too):

| command | description |
|---|---|
| `/play <query>` | play a song or playlist in your current voice channel. autocomplete. |
| `/playtop <query>` | add a song to the front of the queue (plays next). autocomplete. |
| `/skip` | skip the current track |
| `/stop` | stop music and clear the queue |
| `/disconnect` | disconnect from voice without clearing anything (alias: `/leave`) |
| `/reconnect` | migrate to a fresh lavalink node, preserving queue and position (alias: `?rc`) |
| `/pause` | pause the current track |
| `/resume` | resume the paused track |
| `/queue` | show the current music queue |
| `/nowplaying` | show what's currently playing (alias: `?np`) |
| `/volume <0–100>` | set playback volume |
| `/shuffle` | shuffle the queue |
| `/loop` | cycle loop mode: off → track → queue → off (alias: `?repeat`) |
| `/seek <time>` | seek to a position, e.g. `1:30` or `90` |
| `/remove <position>` | remove a track from the queue by its queue position |
| `/move <from> <to>` | move a track to a different position in the queue |
| `/clear` | clear the queue without stopping the current track |
| `/autoplay [enabled]` | toggle autoplay, or set it explicitly with `true`/`false` |

modes (designated channel only — configure `MODE_CHANNEL_ID`):

| command | what happens |
|---|---|
| `?uwu` / `/uwu` | god help you |
| `?boomer` / `/boomer` | everything was better in 1987 |
| `?pirate` / `/pirate` | arr |
| `?nerd` / `/nerd` | footnotes and citations |
| `?overlord` / `/overlord` | fred stops pretending to be polite |
| `?mode` / `/mode` / `?normal` | back to regular fred, who is already plenty |

owner-only commands (response is dm'd privately because some things shouldn't be public):

| command | what it does |
|---|---|
| `?dossview @user` / `/dossview` | shows fred's dossier on a user |
| `?dossdelete @user` / `/dossdelete` | deletes the persisted dossier |
| `?dosswipe @user` / `/dosswipe` | deletes the dossier and current in-session memory |

---

## ai stack

fred tries these in order until one works:

1. **groq** — fast. `llama-3.1-8b-instant` first, escalates to `llama-3.3-70b-versatile`, `llama-4-scout-17b`, `gpt-oss-20b`, `gpt-oss-120b` if needed
2. **gemini** — google's thing. `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash-lite` → `gemini-2.0-flash`
3. **hackclub / grok** — last resort. `x-ai/grok-4.1-fast` via ai.hackclub.com. it's free. don't ask questions.

image and video analysis is gemini only. if gemini is down, fred pretends he can't see and falls back to text.

---

## env vars

| var | required | notes |
|---|---|---|
| `TOKEN` | yes | discord bot token. don't lose it. |
| `GROQ_API_KEY` | yes | groq. the main brain. |
| `GEMINI_API_KEY` | strongly recommended | without this, fred is blind |
| `HACKCLUB_API_KEY` | optional | grok fallback when everything else is on fire |
| `DATABASE_URL` | yes | postgres. fred needs somewhere to store his grievances. |
| `ENABLE_BOT` | optional | `true` to auto-start. default off so you don't accidentally unleash fred. |
| `DASHBOARD_PASSWORD` | optional | locks the dashboard. recommended if you have enemies. |
| `DASHBOARD_ORIGIN` | optional | tighten cors for the dashboard |
| `MODE_CHANNEL_ID` | optional | which channel can run mode commands |
| `BRAVE_SEARCH_API_KEY` | optional | better general search. 2000 free queries/month. |
| `LAVALINK_NODES` | optional | json array of `{url, auth, secure}` to override the default public nodes |
| `LAVALINK_URL` / `LAVALINK_AUTH` / `LAVALINK_SECURE` | optional | quick single-node override |
| `RENDER_EXTERNAL_URL` | optional | set this on render so the keep-alive ping has a target |
| `PROGRESS_UPDATE_MS` | optional | progress bar tick interval in ms (default 7000, 10000 on render) |
| `PROGRESS_UPDATES` | optional | set to `off` to disable the progress bar entirely |
| `PORT` | optional | default `5000` |

---

## hosting on render free tier

fred is tuned to survive 512mb / 0.1 cpu:
- progress bar updates throttle automatically when `RENDER` is detected
- album art cache is a bounded lru (200 entries) so it can't balloon
- node heap is capped and `npm prune --omit=dev` runs at build time
- dashboard polling pauses while the tab is hidden
- a `/health` ping every 4 minutes keeps the dyno from spinning down

if your dyno still falls over, that's lavalink's fault.

---

## setup

```bash
npm install
npm run db:push
npm run dev
```

production, if you trust yourself:

```bash
npm run build
npm start
```

---

## stack

- node.js, express, typescript, socket.io
- react, vite, tailwindcss, shadcn/ui, tanstack query
- postgres + drizzle orm
- discord.js v14
- groq, google generative ai, hackclub ai
- lavalink via shoukaku (music — breaks occasionally, that's lavalink's fault not ours)
- itunes search api for album art (free, no key needed), with fuzzy match scoring so it picks the right cover
