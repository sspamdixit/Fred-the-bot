# fred

A Discord bot with a sharp personality and a web dashboard to manage it. Fred responds to messages in Discord, analyzes images, writes poems, roasts people, generates code, and generally acts like it's too good for everyone — while actually being useful.

---

## Features

### Bot
- Responds when mentioned (`@fred`) or when messages start with `?fred`, `?bubbl`, `!fred`, or `!bubbl`
- All commands available as both `?prefix` and `/slash` commands
- **Passive auto-reply** — jumps into conversations unprompted when chat is controversial, opinionated, or worth commenting on; no @mention required; heuristic-based with zero passive token cost
- Full creative writing: poems, roasts, stories, lyrics, essays
- Code generation in any language
- Image and video analysis (requires Gemini API key)
- Channel summarization + vibe check (`?tldr` / `/tldr`)
- Translation to any language
- Per-channel conversation memory (last 150 messages)
- Long-term per-user memory dossier stored in PostgreSQL
- Authority hierarchy via Discord roles: `owner`, `moderator`, `developer`, `member`
- Slur filter with auto-delete, DM warning, and 10-minute timeout
- Daily question of the day (QOTD) with Discord polls
- AI-generated custom status that refreshes every 30 minutes
- Automatic dead-chat detection in the lounge channel with unique messages each time
- Personality modes in a dedicated mode channel: `?uwu`, `?boomer`, `?pirate`, `?nerd`, `?overlord`
- Modes apply server-wide to every request type (`?fred`, `?roast`, `?explain`, passive replies, etc.)
- Mode theme changes update nickname and status server-wide
- Full Lavalink music system with `?` and `/` equivalents for play, playtop, skip, stop, leave/disconnect, pause, resume, queue, now playing, volume, shuffle, loop/repeat, seek, remove, move, and clear
- `/play` and `/playtop` support live autocomplete track search
- Music playback uses Lavalink node failover and queue auto-advance for more reliable playback

### Dashboard
- Live message feed via Socket.IO
- Bot status and AI usage stats
- Control presence (status, activity type, activity name)
- Send messages to any channel
- Toggle AI providers (Groq, Gemini, Hackclub/Grok)
- Trigger QOTD manually
- Test AI replies directly from the dashboard
- View and manage user memory dossiers

---

## Commands

All commands work with both `/` (slash) and `?` (prefix). Slash commands show autocomplete in Discord.

| Command | Description |
|---|---|
| `/help` / `?help` | Full command list |
| `/status` / `?status` | Current model, token usage, uptime |
| `/ping` / `?ping` | Latency check |
| `/tldr` / `?tldr` | Summarizes recent chat and checks the vibe |
| `/poem <topic>` / `?poem <topic>` | Writes a poem |
| `/roast <target>` / `?roast <target>` | Roasts a person, thing, or idea |
| `/explain <topic>` / `?explain <topic>` | Explains something thoroughly |
| `/translate <lang> <text>` / `?translate <lang> <text>` | Translates text |
| `/fred <message>` / `?fred <message>` | Talk to the AI directly |

`?` aliases: `?bubbl`, `!fred`, `!bubbl` all work for direct AI chat.

Mode commands work only in the designated mode channel:

| Command | Description |
|---|---|
| `/uwu` / `?uwu` | Activate uwu mode |
| `/boomer` / `?boomer` | Activate boomer mode |
| `/pirate` / `?pirate` | Activate pirate mode |
| `/nerd` / `?nerd` | Activate nerd mode |
| `/overlord` / `?overlord` | Activate overlord mode |
| `/mode` / `?mode` / `?normal` | Deactivate current mode |

Owner-only (reply sent privately): `/dossview @user`, `/dossdelete @user`, `/dosswipe @user`  
`?` equivalents also work: `?dossview @user`, `?dossdelete @user`, `?dosswipe @user`

---

## AI Stack

Requests route in this order:

1. **Groq** (primary) — tries `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `openai/gpt-oss-20b`, `openai/gpt-oss-120b`
2. **Gemini** (fallback) — tries `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.0-flash-lite`, `gemini-2.0-flash`
3. **Hackclub / Grok** (last resort) — `x-ai/grok-4.1-fast` via `ai.hackclub.com`

Image and video analysis uses Gemini only. If Gemini is unavailable, the bot falls back to text-only.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TOKEN` | Yes | Discord bot token |
| `GROQ_API_KEY` | Yes | Groq API key |
| `GEMINI_API_KEY` | Recommended | Google Gemini API key (required for image analysis) |
| `HACKCLUB_API_KEY` | Optional | Hackclub API key for Grok fallback |
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon or any Postgres) |
| `ENABLE_BOT` | Optional | Set to `true` to auto-start the bot on launch |
| `DASHBOARD_PASSWORD` | Optional | Password for the web dashboard |
| `PORT` | Optional | Server port (default: `5000`) |

---

## Setup

```bash
npm install
npm run db:push    # sync database schema
npm run dev        # start development server
```

Production:

```bash
npm run build
npm start
```

---

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Socket.IO
- **Frontend**: React, Vite, TailwindCSS, shadcn/ui, TanStack Query
- **Database**: PostgreSQL via Drizzle ORM
- **Bot**: discord.js v14
- **AI**: Groq SDK, Google Generative AI SDK, Hackclub AI
