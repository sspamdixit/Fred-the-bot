# fred

A Discord bot with a sharp personality and a web dashboard to manage it. Fred responds to messages in Discord, analyzes images, writes poems, roasts people, generates code, and generally acts like it's too good for everyone — while actually being useful.

---

## Features

### Bot
- Responds when mentioned (`@fred`) or when messages start with `?fred`, `?bubbl`, `!fred`, or `!bubbl`
- Full creative writing: poems, roasts, stories, lyrics, essays
- Code generation in any language
- Image and video analysis (requires Gemini API key)
- Channel summarization (`?tldr`)
- Translation to any language
- Vibecheck — reads recent chat and judges it
- Per-channel conversation memory (last 150 messages)
- Long-term per-user memory dossier stored in PostgreSQL
- Authority hierarchy via Discord roles: `owner`, `moderator`, `developer`, `member`
- Slur filter with auto-delete, DM warning, and 10-minute timeout
- Daily question of the day (QOTD) with Discord polls
- AI-generated custom status that refreshes every 30 minutes
- Automatic dead-chat detection and poke in the lounge channel

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

| Command | Description |
|---|---|
| `?help` | Full command list |
| `?info` | What the bot is and does |
| `?status` | Current model, token usage, uptime |
| `?ping` | Latency check |
| `?vibecheck` | AI reads the current channel vibe |
| `?tldr` | Summarizes recent chat |
| `?poem <topic>` | Writes a poem |
| `?roast <target>` | Roasts a person, thing, or idea |
| `?explain <topic>` | Explains something thoroughly |
| `?translate <lang> <text>` | Translates text |
| `?code <language> <task>` | Writes working code |
| `?fred <message>` | Talk to the AI directly |

Aliases: `?bubbl`, `!fred`, `!bubbl` all work.

Owner-only (DM responses): `?dossview @user`, `?dossdelete @user`, `?dosswipe @user`

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
