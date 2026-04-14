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
- AI chat responses receive Discord role context; users with the `owner` role or the name `deliv3r` are treated as owner-authority users within the system prompt.
- AI chat memory is retained per channel for up to 150 recent user/assistant messages.

# Migration Notes

- The project was adapted to run on Replit without rewriting the app.
- Replit web preview is configured to use port 5000.
- PostgreSQL schema was synced with Drizzle using the existing schema.
- Development preview allows Replit iframe rendering; production still sends `X-Frame-Options: DENY`.
