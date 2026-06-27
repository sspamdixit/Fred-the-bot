---
name: Kira economy system
description: Gem/gold economy, gacha, and top.gg voting integration
---

Gems (💎): 1 per message to Kira. Free from daily (20) + voting (10). Paid = future.
Gold (🪙): for gacha. 100 = 1 pull, 900 = 10x pull. 50 earned per daily.
Tables: gem_balances, waifu_collection, voting_log — created via direct SQL (drizzle push hangs on interactive prompts for new tables; use executeSql instead)

Gacha: AniList GraphQL API (free, no key). Random page 1-250, FAVOURITES_DESC sort.
Rarities: N(60%) R(25%) SR(10%) SSR(4%) UR(1%). Gold bonus: N=5 R=15 SR=40 SSR=100 UR=500.

top.gg: POST /api/topgg/webhook — INACTIVE until TOPGG_ENABLED=true in server/topgg.ts.
Needs TOPGG_WEBHOOK_SECRET + TOPGG_BOT_ID secrets when activating.
