# Project Overview

This is a full-stack Node.js application with an Express API/server, Vite React frontend, Socket.IO support, Drizzle ORM, and PostgreSQL.

# Replit Configuration

- Runtime: Node.js 20
- Main development command: `npm run dev`
- Web server port: `5000`
- Production build command: `npm run build`
- Production run command: `node ./dist/index.cjs`
- Database schema sync command: `npm run db:push`

# Architecture Notes

- Server code lives in `server/`.
- Client code lives in `client/`.
- Shared schema/types live in `shared/`.
- Static production assets are served from `dist/public` after build.
- API routes are mounted under `/api` and protected by dashboard authentication where appropriate.
- Secrets such as Discord bot tokens and API keys are read from environment variables and must not be committed.
- AI chat responses receive full Discord context per message: server name, channel name, speaker display name, roles sorted by hierarchy (highest → lowest), and a resolved authority level (owner / moderator / developer / member). Authority is determined purely by roles — no hardcoded usernames anywhere in the system instructions.
- AI chat memory is retained per channel for up to 150 recent user/assistant messages.
- Shared AI system instructions, capability notes, and weakness notes are defined in `server/ai-settings.ts`.
- Gemini, Groq, and the Hack Club fallback all use the same shared AI system instructions and bot profile from code.
- Groq text and QOTD generation now try multiple Groq models: `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `openai/gpt-oss-20b`, and `openai/gpt-oss-120b`.
- Discord users can view the bot profile with `?info`; `?help` lists the primary public commands. Legacy aliases `!help` and `!bubbl <message>` remain supported.
- `/overlord` and `?overlord` use a fictional English authoritarian-supervillain voice only; the prompt explicitly forbids imitating Hitler, Nazis, real dictators, extremist ideology, hate, or real-world violence.
- Long-term user memory is stored in Neon PostgreSQL via `process.env.DATABASE_URL` in the `user_memory` table (`user_id` text primary key, `dossier` text).
- The server runs a safe startup initializer for `user_memory` using `CREATE TABLE IF NOT EXISTS` so Render/Neon production environments self-create the table even if local `db:push` was not run against that database.
- AI responses fetch the current user's dossier and inject it into the system prompt as `user record: ...`; missing rows use `new user. no record.`
- After a sent bot reply, memory updates are triggered only when recent bot-directed messages contain substantial personal context such as failures, losses, major worries, school/work setbacks, health issues, important relationships, or pets. The background updater sends only those substantial user messages plus the existing dossier to Groq `llama-3.1-8b-instant`, stores lowercase plain text capped at 100 words, excludes usernames/Discord roles/IDs/generic tech specs/temporary chatter, and skips database writes when unchanged.
- Owner-only Discord dossier commands are handled through text commands: `?dossview @user`, `?dossdelete @user`, and `?dosswipe @user`. The bot attempts to delete the visible command message, sends results by DM for privacy, `?dossdelete` removes the persisted dossier, and `?dosswipe` removes the persisted dossier plus current in-session memory state.
- Discord moderation includes a non-AI slur filter at the start of `messageCreate`. It combines direct obfuscation regexes with leetspeak token normalization for configured slurs, including shortened and altered forms. Matches immediately attempt to delete the message, send a firm DM warning with a fixed random roast regardless of role, apply a 10-minute timeout when Discord permissions/role hierarchy allow it, report action status to moderator channel `1484059697123164264`, log deletion/warning/timeout/report failures, and return before live-feed emission or AI processing so no model tokens are spent.
- The 30-minute lounge vibe check now sends at most one dead-chat follow-up (`the chat is extremely dead.`) after an unanswered bot vibe check, then stays muted until a human posts in the lounge again.
- Discord custom status now refreshes every 30 minutes. AI-generated statuses are weighted toward recent memes, pop culture, gaming, anime, music, celebrity drama, and viral internet references; politics is rare and prompted only for substantial major events. Statuses stay short, lowercase, internet-literate, and may use one fitting emoji from `😭 💀 ✌🏻 💔 🙏🏻`.
- Daily QOTD generation is prompted to stay relevant to a Gen-Z/community Discord audience with gaming, anime/JJBA, internet culture, school/work, taste debates, harmless drama, and weird hypotheticals. QOTD posts mention the `qotd` role and direct discussion to a QOTD talk channel when one exists (`qotd-talk`, `qotd-discussion`, `qotd-chat`, or `question-talk`).

# Migration Notes

- The project was adapted to run on Replit without rewriting the app.
- Replit web preview is configured to use port 5000.
- PostgreSQL schema was synced with Drizzle using the existing schema.
- Development preview allows Replit iframe rendering; production still sends `X-Frame-Options: DENY`.
- Render free-tier optimization pass keeps features intact while reducing idle work: dashboard polling now slows down and pauses while hidden, sockets use websocket transport, live-feed payloads are built only when a dashboard viewer is connected, bot restart clears background timers, QOTD/login/keep-alive timers are unref'd, and the dashboard uses a simpler dark low-animation style instead of animated blurred glass.
- Uptime hardening for Render free tier: the browser app sends a lightweight `/health` ping every 4 minutes even on the login screen, the server continues bot startup if the memory table check has a transient database error, process-level unexpected errors are logged, and a Discord watchdog restarts the client if it stays disconnected for more than 2 minutes.
- Dashboard optimization pass: duplicate AI provider controls were consolidated into Diagnostics, desktop layout now uses a wider two-column workspace for presence and message controls, mobile spacing/actions stack more cleanly, and browser health pings now pause while hidden and run less often.
