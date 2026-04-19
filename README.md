# fred

discord bot + web dashboard. fred talks shit, plays music, reads images, searches the web, and remembers things about your server members. runs on gemini/groq/grok depending on what's alive.

---

## what it does

**bot stuff:**
- responds to `@fred`, `?fred`, `?bubbl`, `!fred`, `!bubbl`
- everything works as both `?prefix` and `/slash` commands
- passive auto-reply — jumps in on its own when a conversation is spicy or worth commenting on, no @mention needed
- creative writing: poems, roasts, stories, lyrics, essays, whatever
- code gen in any language
- image and video analysis (needs gemini key)
- `?tldr` / `/tldr` — summarizes the last bunch of messages and rates the vibe
- translation to any language
- per-channel conversation memory (last 150 messages)
- long-term per-user memory stored in postgres — fred remembers stuff about people across sessions
- role-based authority: `owner`, `moderator`, `developer`, `member`
- slur filter with auto-delete, DM warning, and 10-min timeout
- daily question of the day with discord polls
- ai-generated status that changes every 30 minutes
- dead-chat detection — posts in the lounge when it's been quiet too long
- personality modes in a designated channel: `?uwu`, `?boomer`, `?pirate`, `?nerd`, `?overlord` — apply server-wide to every command
- full music system via lavalink: play, playtop, skip, stop, pause, resume, queue, nowplaying, volume, shuffle, loop, seek, remove, move, clear — all with `?` and `/` equivalents
- `/play` and `/playtop` have autocomplete search
- music has node failover + race condition guards so it doesn't fall apart mid-queue

**web search:**
- `?search <query>` or just ask fred something time-sensitive
- weather via wttr.in (no key)
- crypto prices via coingecko (no key, live data)
- stocks / commodities / forex via yahoo finance (no key, live data)
- general search via duckduckgo html scraping (actual results, not the stale knowledge base api)
- optional upgrade: set `BRAVE_SEARCH_API_KEY` to use brave search instead

**dashboard:**
- live message feed
- bot status + ai usage stats
- control bot presence (status, activity, etc.)
- send messages to any channel
- switch ai providers
- trigger qotd manually
- test ai replies directly
- view and manage user memory dossiers

---

## commands

all commands work with `/` and `?`. slash commands have autocomplete.

| command | what it does |
|---|---|
| `?help` / `/help` | command list (context-aware — shows music cmds only if relevant) |
| `?status` / `/status` | current model, token usage, uptime |
| `?ping` / `/ping` | latency |
| `?tldr` / `/tldr` | summarizes recent chat |
| `?poem <topic>` | writes a poem |
| `?roast <target>` | roasts something |
| `?explain <topic>` | explains something |
| `?translate <lang> <text>` | translates |
| `?search <query>` | live web search |
| `?fred <message>` | talk to fred |

mode commands (mode channel only):

| command | mode |
|---|---|
| `?uwu` / `/uwu` | uwu |
| `?boomer` / `/boomer` | boomer |
| `?pirate` / `/pirate` | pirate |
| `?nerd` / `/nerd` | nerd |
| `?overlord` / `/overlord` | overlord |
| `?mode` / `/mode` / `?normal` | back to normal |

owner-only (reply is private): `?dossview @user`, `?dossdelete @user`, `?dosswipe @user`

---

## ai stack

tries providers in this order:

1. **groq** — `llama-3.1-8b-instant` → `llama-3.3-70b-versatile` → `llama-4-scout-17b` → `gpt-oss-20b` → `gpt-oss-120b`
2. **gemini** — `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.0-flash-lite` → `gemini-2.0-flash`
3. **hackclub / grok** — `x-ai/grok-4.1-fast` via ai.hackclub.com

image/video analysis is gemini only. if gemini's down, falls back to text.

---

## env vars

| var | required | notes |
|---|---|---|
| `TOKEN` | yes | discord bot token |
| `GROQ_API_KEY` | yes | groq api key |
| `GEMINI_API_KEY` | recommended | needed for image analysis |
| `HACKCLUB_API_KEY` | optional | grok fallback |
| `DATABASE_URL` | yes | postgres connection string |
| `ENABLE_BOT` | optional | set to `true` to auto-start the bot |
| `DASHBOARD_PASSWORD` | optional | dashboard login |
| `BRAVE_SEARCH_API_KEY` | optional | upgrades general search to brave |
| `PORT` | optional | default `5000` |

---

## setup

```bash
npm install
npm run db:push
npm run dev
```

production:

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
- groq sdk, google generative ai, hackclub ai
- lavalink (shoukaku) for music
