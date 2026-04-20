# fred

fred is a discord bot. he's smarter than you, he knows it, and he will not shut up about it. he plays music, searches the web, remembers embarrassing things about your server members, and occasionally says something genuinely useful by accident.

built with way too many api keys and a concerning amount of lavalink nodes.

---

## what fred does (that you couldn't do yourself)

**talking shit:**
- responds to `@fred`, `?fred`, `!fred` — pick your poison
- everything works as `/slash` commands too because fred respects accessibility
- **passive mode** — fred jumps into conversations without being @mentioned when someone says something stupid enough to warrant a response. heuristic-based. zero extra cost. maximum chaos.
- writes poems, roasts, stories, lyrics, essays. they're better than yours.
- generates code in any language, including ones you probably shouldn't be using
- analyzes images and videos and will tell you exactly what's wrong with them
- `?tldr` — reads the last 150 messages so you don't have to, then rates the vibe. spoiler: it's usually bad.
- translates to any language, including ones you'll mispronounce immediately
- remembers context per channel (last 150 messages) and per user forever (postgres). fred knows things about your members that they've forgotten they said.
- role-based hierarchy: `owner`, `moderator`, `developer`, `member` — because not everyone deserves to tell fred what to do
- slur filter with auto-delete, dm warning, and a 10-minute timeout. fred has standards, unlike some of your members.
- daily question of the day with discord polls. thought-provoking. divisive. mostly fred's idea.
- ai-generated status message that changes every 30 minutes. fred is always doing something more interesting than you.
- dead-chat detection — fred notices when your server goes quiet and does something about it. you're welcome.
- personality modes (`?uwu`, `?boomer`, `?pirate`, `?nerd`, `?overlord`) that apply server-wide. yes, even to roasts. especially to roasts.

**actually knowing things:**
- `?search <query>` or just ask fred something that requires a working internet connection
- weather via wttr.in — real data, no key required
- crypto prices via coingecko — live, accurate, no key, will not tell you whether to buy
- stocks / commodities / forex via yahoo finance — also live, also accurate, also not financial advice
- general web search via duckduckgo html scraping — actual results from the actual web, not some stale knowledge base from 2022
- if you have a `BRAVE_SEARCH_API_KEY` lying around, fred will use that instead and be slightly more thorough about it

**music (the part that actually breaks):**
- full lavalink music system: play, playtop, skip, stop, pause, resume, queue, nowplaying, volume, shuffle, loop, seek, remove, move, clear, disconnect
- `/play` and `/playtop` have autocomplete so you don't have to spell correctly
- now-playing embed shows song title, album art (sourced from iTunes, falls back to YouTube thumbnail), progress bar updating every second, and artist name
- album art is always square. youtube thumbnails are cropped. you're welcome.
- multiple lavalink nodes with automatic failover — when one dies (and it will), fred migrates to another one mid-queue without dropping your carefully curated vibe
- race condition guards so fred doesn't play two songs at once or skip nothing into the void

**the dashboard (for people who prefer clicking):**
- live message feed — watch fred talk in real time, feel jealous
- bot stats, token usage, uptime
- control fred's presence (status, activity, etc.)
- send messages to any channel. yes, anonymously. no, we're not responsible.
- switch ai providers on the fly
- trigger qotd manually when the server needs drama
- test ai replies without going to discord
- browse and delete what fred remembers about your users. it's a lot.

---

## commands

slash commands have autocomplete. prefix commands are for people who remember irc.

| command | description |
|---|---|
| `?help` / `/help` | shows commands. context-aware — music commands only appear if you're in voice or a music channel. |
| `?status` / `/status` | model, token count, uptime. a report card nobody asked for. |
| `?ping` / `/ping` | latency. fred is fast. your internet might not be. |
| `?tldr` / `/tldr` | summarizes chat. judges your server. |
| `?poem <topic>` | better than anything you'd write |
| `?roast <target>` | you asked for this |
| `?explain <topic>` | explains things to you slowly |
| `?translate <lang> <text>` | works on any language including klingon probably |
| `?search <query>` | live web search |
| `?fred <message>` | talk to fred directly. he'll respond. he might not be nice about it. |

music commands:

| command | description |
|---|---|
| `/play <query>` | play a song or playlist in your current voice channel. has autocomplete. |
| `/playtop <query>` | add a song to the front of the queue (plays next). has autocomplete. |
| `/skip` | skip the current track |
| `/stop` | stop music and clear the queue |
| `/disconnect` | disconnect from voice without clearing anything |
| `/pause` | pause the current track |
| `/resume` | resume the paused track |
| `/queue` | show the current music queue |
| `/nowplaying` | show what's currently playing |
| `/volume <0–100>` | set playback volume |
| `/shuffle` | shuffle the queue |
| `/loop` | cycle loop mode: off → track → queue → off |
| `/seek <time>` | seek to a position, e.g. `1:30` or `90` |
| `/remove <position>` | remove a track from the queue by its queue position |
| `/move <from> <to>` | move a track to a different position in the queue |
| `/clear` | clear the queue without stopping the current track |

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
`?dossview @user`, `?dossdelete @user`, `?dosswipe @user`

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
| `BRAVE_SEARCH_API_KEY` | optional | better general search. 2000 free queries/month. |
| `PORT` | optional | default `5000` |

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
- itunes search api for album art (free, no key needed)
