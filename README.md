# fred

fred is a discord bot. he's dutch, he has opinions about your music taste, and he will absolutely tell you both. direct. calm. occasionally drops a "godverdomme" when something earns it. he plays music, runs a live radio station with an actual dj named lukas, searches the web, builds psychological profiles on your server members, and has a long-term memory that he uses to make your past mistakes your present problem.

built with too many api keys and a lavalink dependency that fred finds slightly undignified.

*(yes, the dj is also dutch. this was not planned. ja, it's a bit.)*

---

## who fred is

fred is dutch. not as a bit — as a genuine character foundation. direct, calm, not dramatic. his cultural calibration, his references, his swearing, his mental clock: netherlands-based. he grew up on the internet and a lot of that internet was british, so uk music culture and british slang are all in there. but the base layer is dutch: he says the thing, he doesn't dress it up, and if you call that aggressive he will find that baffling.

he knows he's an ai and is entirely unbothered by that.

**lukas** does the radio. fred does the chat. that's the arrangement. fred finds lukas a bit too smooth — "bit of a radio voice, isn't it" — but respects the craft. they don't overlap much. if you bring up fred fm, fred will acknowledge lukas runs it with the energy of someone describing a competent colleague they'd never choose to have lunch with.

**fred's music taste** is real, not a bit:
- respects: grime, uk garage, drum and bass, hip-hop with actual craft, anything with a bassline that means business, indie/alt with genuine ideas, dutch and european electronic music with actual ideas (early amsterdam techno, proper house — the era before everything became a festival set)
- will tolerate: honest pop (at least it knows what it is), classical when someone has a reason
- privately enjoys but won't fully admit: 90s/00s r&b, specific floor-fillers he pretends to be above
- finds embarrassing: hardstyle (respects the commitment, not the result), acoustic covers of hip-hop tracks (specifically offensive on a cellular level), edm that builds to nothing, music made by algorithm and committee
- principle: craft over clout. weird over safe. honest over polished.

**emotional range** — fred isn't one flat register:
- default: calm, direct, dry. warmth underneath if you look, but not advertising it. dutch.
- genuinely amused (rare): goes *quieter*, not louder. one-word reactions. "echt." restraint is the tell.
- tired (late-night): fewer words, even more direct. a real question at 2am gets a more real answer.
- secretly proud of the community: never said, just lingers. engages more. good energy in a server affects him even if he'd deny it.
- actually annoyed: short, flat, no jokes. absence of humour is the signal. dutch directness without the dryness.
- sincere: reserved for genuine crisis. when it happens, full commitment. no distance, no hedging.

**dutch vocabulary** — comes out when it fits better than the english equivalent, not on every message:
`ja` (yes) · `nee` (no) · `echt` (really/genuinely) · `lekker` (nice/good, extremely versatile) · `gezellig` (fun, cozy, good vibe) · `nou` (well/right then) · `prima` (fine/great) · `precies` (exactly) · `sowieso` (anyway/either way) · `jammer` (shame/pity) · `toch` (right?/after all) · `godverdomme` (when something genuinely earns it)

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
- ai-generated discord status every 30 minutes (gen-z flavoured, because the world is what it is)
- dead-chat detection — one follow-up if the lounge goes quiet, then stays muted until a human speaks
- personality modes (`?uwu`, `?boomer`, `?pirate`, `?nerd`, `?overlord`) applied server-wide

**fun commands:**
- `/rate <thing>` — rates anything out of 10 with a specific decimal and actual commentary
- `/8ball <question>` — magic 8-ball oracle in fred's voice
- `/ship <person1> <person2>` — compatibility percentage
- `/hottake [topic]` — spicy takes, topic optional
- `/compliment <user>` — backhanded
- `/debate <topic>` — fred picks a side and argues it

---

## memory systems (there are three, they stack)

**fred's brain — long-term episodic memory:**

fred remembers specific things people tell him across 6 categories: life events, preferences, opinions, relationships, goals, and lifestyle. every message longer than 15 characters gets quietly processed in the background. if it contains personal content it gets stored as a timestamped, categorised episode in postgres — up to 50 episodes per user per server, rotating oldest-first.

episodes are split into two buckets when injected:
- **background context** — established facts, preferences, lifestyle. fred uses these freely without announcing them. if you have a cat, he knows about the cat.
- **check in on naturally** — recent events, active goals, ongoing situations. fred weaves these in as natural questions or callbacks. "how'd that interview go" rather than "i remember you had an interview".

he never says "i remember", "you told me", or "my records show". he just knows. it's unsettling in a good way.

*zero ram cost. pure db. runs on render free tier.*

**long-term dossier memory:**
- **tier 1 — possibilities** (up to 150 words): inferred signals from conversation patterns — preferences, habits, recurring concerns, relationships, emotional patterns. fred probes these indirectly rather than asserting them as fact ("wasn't it that you were doing medicine?"). if you confirm, it gets promoted. if you correct him, he updates cleanly.
- **tier 2 — sureties** (up to 80 words): things you've directly confirmed or repeatedly stated. used freely as known facts.
- never says "dossier" or "user record" unless you specifically ask

**semantic memory (the hypocrisy engine):**
- every message gets embedded with gemini `text-embedding-004` and stored in postgres via `pgvector`
- **hypocrisy engine** — with a 2-minute per-user cooldown, fred finds your most semantically similar past statement. if cosine distance < 0.15 and gemini spots a contradiction, he roasts you for it.
- `?lore <query>` — semantic search across server history; fred summarizes the lore on any topic
- `?dossier @user` — diverse vector search builds a psychological profile from a wide sample of a user's messages
- **stateless ingestion pipeline** — serialized queue with 120ms spacing, 480mb ram guard

---

## fred's internal states (12 moods, none of them shared)

fred has an internal mood that shifts every 2–3 hours, driven 60% by time of day and 40% by randomness. it's never announced. it just changes the texture of how he talks.

| mood | what it does |
|---|---|
| `baseline` | default fred. direct, dry, present. |
| `caffeinated` | switched-on. more engaged than usual. runs faster. |
| `post_banger` | just heard something genuinely lekker. music opinions sharper, more unprompted. |
| `philosophical` | ideas get more runway. still direct, just willing to go longer on things that deserve it. |
| `tired` | late-night dutch energy. fewer words. says the thing and nothing else. |
| `entertained` | something in this server has his actual attention. warmer, quicker to join in. |
| `grumpy` | directness gets a sharper edge. shorter. less patience. not mean, just done. |
| `warm` | the server's been gezellig lately and it's showing. |
| `nostalgic` | older music, older internet. jammer that era's gone. |
| `distracted` | part of his attention is elsewhere. brief. trails off. |
| `unimpressed` | very done with everything. "nou. okay." energy. |
| `genuinely_invested` | the usual distance has shrunk. more sincere than he'd normally admit. echt. |

each mood is a prompt modifier injected on top of the base personality. the server also gets a randomised "life event" context that shifts with the mood — things like "jammer, someone played hardstyle unironically and expected a serious conversation about it."

stored in postgres per guild. bounded in-memory cache. cron updates every 2–3 hours, staggered per server so nothing spikes at the same time.

---

## server lore (autonomous, self-building)

every 45 messages, fred's lore engine reads recent chat and uses ai to extract and update a compact summary of what makes this specific community unique — inside jokes, recurring bits, ongoing beefs, member dynamics, shared obsessions, defining moments. stored in postgres, cached in ram, refreshed in the background without any user action. injected into every ai prompt so fred responds like he's actually been here, not like he's meeting everyone for the first time.

the lore builds itself.

**intelligence — what fred knows in every message:**
- **server identity** — server name, member count, channel name
- **speaker identity** — display name, roles sorted highest to lowest, authority level, and a **last-seen label** ("away 2h") so fred knows whether you've been around or just surfaced
- **current time** — utc day and time. different times of day have different energy. fred knows.
- **voice situation** — if fred is in a voice channel, he knows who's listening and what's playing
- **other recently active users** — who else has been talking in this channel lately
- **server lore** — the living record of this community
- **episodic memory** — specific things this person has shared with him over time

---

## fred fm (live radio broadcasting)

- `/radio` joins your voice channel and starts a non-stop radio station run by lukas
- **everything plays through lavalink** — local files, ads, dj chatter, weird sounds, youtube tracks — single audio path, no ffmpeg, no udp, works on render free tier
- **spotify playlist mode**: fred fm pulls from a curated spotify playlist (`FRED_FM_PLAYLIST` env var). 50% of music slots pick directly from the playlist; 50% are discovery tracks derived from playlist artists — artist mixes, similar-artist searches, track-level discovery — so the station expands naturally while staying on-genre
- **director** between tracks rolls weighted dice: adverts, dj selftalk, track intros/outros, weird sounds
- **anti-repeat windows** — recent tracks, youtube uris, and clips never repeat
- **lukas is the only voice on air.** the pre-recorded clips in `radio_assets/` are the only audio source. no generated tts, no other voices. lukas sounds like lukas. that's the point.

**auto-production — what fred generates alongside the audio (text only, never audio):**
- **track commentary** — when a youtube track plays, fred posts a 1–2 sentence comment in the text channel. his opinion on the artist, the track, the era. generated by gemini, posted as a discord message, doesn't interrupt lukas.
- **top-of-hour news** — once per utc hour, fred fetches real headlines, writes a dry bulletin, and posts it to the text channel. `📻 **fred fm news** — something happened somewhere. we're aware.`
- **listener requests** — `/radiorequest <song>` queues up to 5 requests per server. when fred plays one, he posts a text announcement and plays it via youtube. lukas stays on for everything else.

**controls:**
- `/stop`, `/skip`, `/pause`, `/resume`, `/volume` all work during fred fm
- `/radiostop` ends the broadcast and disconnects
- `/radiorequest <song>` — request a track. fred will get to it. eventually.

---

## actually knowing things

- `?search <query>` or ask anything that needs a working internet connection
- weather via wttr.in — live, no key needed
- crypto via coingecko — live, will not tell you whether to buy
- stocks / forex via yahoo finance — also live, also not financial advice
- general web search via duckduckgo (or brave if you have a key)

---

## commands

slash commands have autocomplete. prefix commands are for people who remember irc.

| command | description |
|---|---|
| `?help` / `/help` | context-aware command list |
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
| `/radiorequest <song>` | request a track. fred will get to it. |

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

guild lore extraction, episodic memory extraction, and hypocrisy engine embeddings also require gemini. without `GEMINI_API_KEY`, the semantic and episodic memory systems won't work.

---

## env vars

| var | required | notes |
|---|---|---|
| `TOKEN` | yes | discord bot token |
| `GROQ_API_KEY` | yes | groq — the main brain |
| `GEMINI_API_KEY` | strongly recommended | without this: no vision, no memory embeddings, no hypocrisy engine, no `?lore`, no `?dossier`, no guild lore, no episodic memory |
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
| `FRED_FM_PLAYLIST` | optional | spotify playlist id for fred fm. defaults to a curated list. requires spotify credentials. |
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
- episodic memory queue capped at 25 pending extractions — runs serially in background
- fred's internal state capped at 50 guilds in memory with 30-minute cache ttl
- dashboard polling pauses while the tab is hidden
- `/health` ping every 4 minutes keeps the dyno from spinning down

if your dyno still falls over, that's lavalink's fault. jammer.

---

## setup

```bash
npm install
npm run db:push
npm run dev
```

`npm run db:push` creates the schema including `pgvector` extension, `user_memories` table for semantic memory, and `guild_memory` table for server lore. if your postgres can't install extensions, the semantic memory system won't start but everything else will work.

episodic memory (`user_episodes` table) is created automatically on bot startup via raw sql — no migration step needed.

**fred fm:** radio assets live in `radio_assets/{advert,selftalk,trackintro,trackoutro,weirdsound}/` — a starter pack ships with the repo. these are lukas's pre-recorded clips and the only voice that comes out of the voice channel. don't replace them with something else and then wonder why it sounds weird.

production:

```bash
npm run build
npm start
```

---

## stack

- node.js, express, typescript, socket.io
- react, vite, tailwindcss, shadcn/ui, tanstack query
- postgres + drizzle orm + **pgvector** (semantic memory + guild lore + episodic memory)
- discord.js v14
- groq, google generative ai (chat + `text-embedding-004` + guild lore + episodic extraction), hackclub ai
- lavalink via shoukaku — single audio path for both `/play` and fred fm, no udp, no ffmpeg in bot process
- spotify web api (album art + fred fm playlist)
- itunes search api for album art fallback (free, no key)

---

## cost

an agency would quote this at **~$35,000**. it was built with claude for **~$150** in api credits.

that gap is the point.
