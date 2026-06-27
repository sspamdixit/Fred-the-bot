---
name: Kira bot transformation
description: Full rebrand of Fred Discord bot to Kira waifu AI with gacha/economy
---

Deleted: server/music.ts, dj.ts, tts.ts, radio.ts, radio-producer.ts, mood-engine.ts
Removed from bot.ts: slur filter, rate limiting, shoukaku/lavalink, @discordjs/voice
Added: server/economy.ts, server/gacha.ts, server/topgg.ts
Added pages: privacy-policy.tsx, terms.tsx
Rewrote: server/ai-settings.ts (Kira persona), server/bot.ts, server/routes.ts, server/storage.ts
DB tables removed: savedPlaylists, playlistTracks — storage.ts stripped of all playlist methods
Trigger word changed from "fred" to "kira" in bot.ts message handler

**Why:** User wanted waifu/gacha bot with gem economy for monetization
**How to apply:** Kira persona lives in server/ai-settings.ts DEFAULT_SYSTEM_INSTRUCTIONS
