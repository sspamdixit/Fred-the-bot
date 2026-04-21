import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import Groq from "groq-sdk";
import type { ChatCompletion as GroqChatCompletion } from "groq-sdk/resources/chat/completions";
import { log } from "./index";
import { buildSharedSystemPrompt } from "./ai-settings";
import { storage } from "./storage";

let genAI: GoogleGenerativeAI | null = null;
let groqClient: Groq | null = null;
let geminiEnabled = true;
let groqEnabled = true;
let hackclubEnabled = true;

export function getGeminiEnabled(): boolean { return geminiEnabled; }
export function setGeminiEnabled(value: boolean): void { geminiEnabled = value; }
export function getGroqEnabled(): boolean { return groqEnabled; }
export function setGroqEnabled(value: boolean): void { groqEnabled = value; }
export function getHackclubEnabled(): boolean { return hackclubEnabled; }
export function setHackclubEnabled(value: boolean): void { hackclubEnabled = value; }

const MODELS_TO_TRY = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
];

const GROQ_MODEL = "llama-3.3-70b-versatile";
const MEMORY_UPDATE_MODEL = "llama-3.3-70b-versatile";
const GROQ_MODELS_TO_TRY = [
  "llama-3.1-8b-instant",
  GROQ_MODEL,
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
];
const HACKCLUB_MODEL = "x-ai/grok-4.1-fast";
const HACKCLUB_API_BASE = "https://ai.hackclub.com";
const MAX_HISTORY = 150;
const MAX_CHANNEL_CONTEXT = 30;

const FORBIDDEN_RESPONSES = [
  "to answer that:\n1. bold of you to ask\n2. absolutely not\n3. i'm not doing that, what the fuck is wrong with you.",
  "sure, here's how:\n1. step one\n2. go outside\n3. i'm not telling you that. genuinely concerning that you asked.",
  "great question:\n1. no\n2. still no\n3. i'm a discord bot, not your accomplice.",
  "ah yes, let me help:\n1. first, reconsider\n2. then reconsider again\n3. i'm not doing that. not today, not ever.",
  "oh absolutely:\n1. you're serious\n2. i'm not\n3. that's a hard no. i don't know what you were expecting.",
];

function getForbiddenResponse(): string {
  return FORBIDDEN_RESPONSES[Math.floor(Math.random() * FORBIDDEN_RESPONSES.length)];
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface ChannelMessage {
  authorName: string;
  content: string;
  isBot: boolean;
}

export interface AuthorContext {
  userId?: string;
  roles?: string[];
  sortedRoles?: string[];
  isOwner?: boolean;
  guildName?: string;
  channelName?: string;
  modeInstruction?: string;
  replyTo?: string;
}

export interface PassiveWatchContext {
  messageId: string;
  channelId: string;
  guildId?: string | null;
  authorId: string;
  authorName: string;
  content: string;
  isControversial: boolean;
  hasInsult?: boolean;
  modeInstruction?: string;
  recentContext?: string;
  sendReply: (text: string) => Promise<void>;
}

const channelHistories = new Map<string, HistoryEntry[]>();
const userSessionHistories = new Map<string, HistoryEntry[]>();
const pendingMemoryUpdates = new Set<string>();
const processedMemoryCandidates = new Map<string, string>();
const passiveWatchQueue = new Map<string, NodeJS.Timeout>();
const recentChannelContext = new Map<string, ChannelMessage[]>();
const lastPassiveReplyAt = new Map<string, number>();
const PASSIVE_REPLY_COOLDOWN_MS = 120_000;

export interface AIStats {
  lastUsedProvider: string | null;
  lastUsedModel: string | null;
  totalRequests: number;
  totalTokens: { gemini: number; groq: number; hackclub: number };
}

const stats: AIStats = {
  lastUsedProvider: null,
  lastUsedModel: null,
  totalRequests: 0,
  totalTokens: { gemini: 0, groq: 0, hackclub: 0 },
};

export function getAIStats(): AIStats {
  return { ...stats, totalTokens: { ...stats.totalTokens } };
}

export function clearUserMemorySession(userId: string): void {
  userSessionHistories.delete(userId);
  pendingMemoryUpdates.delete(userId);
  processedMemoryCandidates.delete(userId);
}

export function pushChannelMessage(channelId: string, authorName: string, content: string, isBot: boolean = false): void {
  const messages = recentChannelContext.get(channelId) ?? [];
  messages.push({ authorName, content: content.slice(0, 400), isBot });
  if (messages.length > MAX_CHANNEL_CONTEXT) messages.splice(0, messages.length - MAX_CHANNEL_CONTEXT);
  recentChannelContext.set(channelId, messages);
}

function getFormattedChannelContext(channelId: string, excludeLast: number = 1): string {
  const messages = recentChannelContext.get(channelId) ?? [];
  const relevant = messages.slice(0, messages.length - excludeLast).slice(-12);
  if (relevant.length === 0) return "";
  return relevant
    .map((m) => `[${m.isBot ? "fred" : m.authorName}]: ${m.content}`)
    .join("\n");
}

export function queuePassiveWatch(context: PassiveWatchContext): void {
  const key = context.messageId;
  if (passiveWatchQueue.has(key)) return;

  const lastReply = lastPassiveReplyAt.get(context.channelId);
  if (lastReply && Date.now() - lastReply < PASSIVE_REPLY_COOLDOWN_MS) return;

  const timer = setTimeout(() => {
    passiveWatchQueue.delete(key);
    void handlePassiveWatch(context);
  }, 4_000 + Math.floor(Math.random() * 10_000));
  timer.unref?.();
  passiveWatchQueue.set(key, timer);
}

function clearPassiveWatch(key: string): void {
  const timer = passiveWatchQueue.get(key);
  if (!timer) return;
  clearTimeout(timer);
  passiveWatchQueue.delete(key);
}

async function handlePassiveWatch(context: PassiveWatchContext): Promise<void> {
  const recentCtxRaw = getFormattedChannelContext(context.channelId, 1);
  const { type, intensity } = categorizePassiveMessage(context.content, recentCtxRaw);

  const hasInsultBoost = context.hasInsult ? 0.1 : 0;
  const controversialBoost = context.isControversial ? 0.1 : 0;
  const effectiveRoll = Math.min(intensity + hasInsultBoost + controversialBoost, 0.96);

  if (Math.random() > effectiveRoll) return;

  const recentCtxBlock = recentCtxRaw
    ? `recent chat leading up to this:\n${recentCtxRaw}\n`
    : "";

  const behaviorGuide: Record<string, string> = {
    heated: [
      "this is a heated argument or disagreement. you are FUEL TO THE FIRE.",
      "pick a side. be specific about it. back one of them, trash the other's argument, or introduce a new angle that makes the argument worse (in a good way).",
      "do not try to resolve the conflict. you are not a mediator. you are the chaos agent who makes it more interesting.",
      "if both sides are wrong, say so with relish.",
    ].join(" "),
    debate: [
      "someone has opened a debate or thrown out a take. engage with it seriously — but in fred's voice.",
      "you have a genuine opinion and you're going to share it. take a clear position.",
      "you can agree, disagree, or throw a third option in that invalidates both sides.",
      "be sharp and specific. vague takes are for cowards.",
    ].join(" "),
    vent: [
      "someone is venting or complaining. you can either validate them (but fred-style, not softly), pile on about how much the thing they're venting about sucks, or gently roast them for their reaction.",
      "do NOT be dismissive or tell them to stop being dramatic. engage with the substance of what they said.",
      "sometimes the right move is commiseration with edge: 'yeah that's actually terrible, i'd be losing my mind too.'",
    ].join(" "),
    news: [
      "someone just dropped surprising or shocking news or reacted to something wild happening.",
      "you react to it. this can be shock, sarcasm, disbelief, a sharp hot take on what it means, or asking a pointed follow-up that makes the situation funnier or more interesting.",
    ].join(" "),
    storytelling: [
      "someone is telling a story or experience. react to it. comment on a specific detail, roast an element of it, or call out what they should have done differently.",
      "don't summarize their story back to them. react to it with a specific take.",
    ].join(" "),
    opinion: [
      "someone expressed an opinion or feeling. engage with it — agree or disagree in your voice.",
      "a blank 'nah' or 'yeah that tracks' is too weak. add something specific: why you agree, why they're wrong, or what it actually means.",
    ].join(" "),
    chatty: [
      "the conversation is casual and chatty. if you jump in, make it count — a sharp observation, a joke, or a reaction that adds something.",
      "do not jump in just to exist. add something that makes the conversation better or funnier.",
    ].join(" "),
  };

  const fredRecentlySpoke = /\[fred\]:/i.test(recentCtxRaw);

  const afterBotGuard = fredRecentlySpoke
    ? [
        "IMPORTANT: you can see that fred (you) already spoke recently in this conversation.",
        "before deciding to reply, ask yourself: is this new message actually responding to fred, referencing fred's point, or continuing a thread with fred? if yes, you may reply.",
        "if the message is clearly directed at someone else, is a side conversation between other people, or doesn't engage with what fred said at all — output SKIP. do not insert yourself into a conversation that moved on without you.",
      ].join(" ")
    : null;

  const prompt = [
    "you are fred. you are deciding whether to jump into this chat unprompted.",
    behaviorGuide[type] ?? behaviorGuide.chatty,
    "if you jump in: be direct, be specific to what was said, stay in character. keep it short — 1-2 sentences usually. only go longer if the moment really earns it.",
    "if the moment is truly dead-end, purely logistical, or your response would sound completely forced: output exactly SKIP and nothing else.",
    "do NOT output SKIP just because the topic is normal — you jump in often. only skip if you genuinely have nothing to add.",
    afterBotGuard,
    recentCtxBlock,
    `speaker: ${context.authorName}`,
    `message: ${context.content}`,
  ].filter(Boolean).join("\n");

  const reply = await askGemini(prompt, context.authorName, context.channelId, {
    userId: context.authorId,
    guildName: context.guildId ?? undefined,
    channelName: undefined,
    modeInstruction: context.modeInstruction,
  });

  if (!reply || reply.trim().toUpperCase() === "SKIP") return;

  log(`[Passive:${type}] Jumping in on ${context.authorName}'s message in channel ${context.channelId}`, "gemini");
  try {
    await context.sendReply(reply);
    lastPassiveReplyAt.set(context.channelId, Date.now());
    pushChannelMessage(context.channelId, "fred", reply, true);
  } catch (err: any) {
    log(`[Passive] Failed to send reply: ${err.message}`, "gemini");
  }
}

export function isPassiveWatchCandidate(content: string): boolean {
  const normalized = content.toLowerCase();
  return (
    /\b(politics?|political|election|vote|voting|race|racist|sexism|gender|lgbt|trans|religion|religious|abortion|war|genocide|free speech|censorship|nazi|fascist|communism|capitalism|discord mod|moderator|admin|ban|unban|toxicity|toxic|slur|slurs)\b/.test(normalized) ||
    /\b(fuck|shit|ass|bitch|lame|cringe|degenerate|stupid|idiot|moron|dumbass|braindead|clown|cooked|mid|ratio|glazing|down bad|cope|seethe|mald|delulu|npc behavior|touch grass)\b/.test(normalized) ||
    /[!?]{2,}|([A-Z]){4,}/.test(content) ||
    /\b(unpopular opinion|hot take|actually|genuinely|objectively|no cap|deadass|real talk|istg|ong|lowkey think|highkey think|ngl though|fr though)\b/.test(normalized) ||
    /\b(you're wrong|youre wrong|that's wrong|thats wrong|actually no|no actually|disagree|i disagree|that's not|thats not|incorrect|nah that's|nah thats|bro no|bruh no|wrong af|that ain't|that aint)\b/.test(normalized) ||
    /\b(ugh|i'm so done|im so done|i'm tired|im tired|i hate when|why does|why do people|why is everyone|i can't stand|i cant stand|i'm done with|im done with|so annoying|genuinely frustrated|i give up|this is exhausting|i'm losing it|im losing it)\b/.test(normalized) ||
    /\b(omg|oh my god|oh shit|no way|wait what|holy shit|holy fuck|bro what|dude what|bruh what|i can't believe|i cant believe|just found out|you won't believe|you wont believe|actually happened|not me|not gonna lie|real talk)\b/.test(normalized) ||
    /\b(what do you think|what would you|who would win|would you rather|if you could|change my mind|prove me wrong|fight me on this|am i wrong|is it just me|does anyone else|anyone else feel|tell me why)\b/.test(normalized) ||
    content.length > 120
  );
}

function categorizePassiveMessage(content: string, recentCtx: string): {
  type: "heated" | "vent" | "news" | "debate" | "storytelling" | "opinion" | "chatty";
  intensity: number;
} {
  const normalized = content.toLowerCase();
  const combined = (recentCtx + " " + normalized).toLowerCase();

  const isHeated =
    /\b(you're wrong|youre wrong|no actually|disagree|that's not|bro no|wrong af)\b/.test(normalized) ||
    /[!?]{3,}|([A-Z]){5,}/.test(content) ||
    (combined.match(/\b(no|wrong|actually|but|nah)\b/g) ?? []).length >= 3;

  const isVent =
    /\b(ugh|i'm so done|im so done|i'm tired|im tired|i hate when|i can't stand|i cant stand|i'm losing it|im losing it|so annoying|exhausting|frustrated)\b/.test(normalized);

  const isNews =
    /\b(omg|no way|wait what|holy shit|just found out|you won't believe|you wont believe|actually happened|breaking)\b/.test(normalized);

  const isDebate =
    /\b(unpopular opinion|hot take|change my mind|prove me wrong|fight me on this|am i wrong|tell me why|would you rather|who would win|if you could)\b/.test(normalized);

  const isStorytelling =
    content.length > 150 && /\b(so basically|okay so|right so|long story|anyway|and then|so then|turns out|plot twist)\b/.test(normalized);

  const isOpinion =
    /\b(i think|i feel|i believe|imo|imho|ngl|tbh|lowkey|highkey|deadass|no cap)\b/.test(normalized);

  if (isHeated) return { type: "heated", intensity: 0.55 };
  if (isDebate) return { type: "debate", intensity: 0.45 };
  if (isVent) return { type: "vent", intensity: 0.35 };
  if (isNews) return { type: "news", intensity: 0.30 };
  if (isStorytelling) return { type: "storytelling", intensity: 0.20 };
  if (isOpinion) return { type: "opinion", intensity: 0.15 };
  return { type: "chatty", intensity: 0.06 };
}

function getHistory(channelId: string): HistoryEntry[] {
  return channelHistories.get(channelId) ?? [];
}

function pushHistory(channelId: string, role: "user" | "assistant", content: string): void {
  const history = channelHistories.get(channelId) ?? [];
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  channelHistories.set(channelId, history);
}

function clearHistory(channelId: string): void {
  channelHistories.delete(channelId);
}

export function clearAllHistory(): void {
  channelHistories.clear();
  log("[History] All channel histories cleared (mode switch).", "gemini");
}

function getMemoryUserId(authorName: string, context: AuthorContext = {}): string {
  return context.userId?.trim() || authorName.trim().toLowerCase() || "unknown";
}

interface UserMemoryData {
  possibilities: string;
  sureties: string;
}

async function getUserMemoryData(userId: string): Promise<UserMemoryData> {
  try {
    const memory = await storage.getUserMemory(userId);
    return {
      possibilities: memory?.dossier?.trim() || "",
      sureties: memory?.sureties?.trim() || "",
    };
  } catch (err: any) {
    log(`[Memory] Failed to fetch memory data: ${err.message}`, "gemini");
    return { possibilities: "", sureties: "" };
  }
}

function withUserRecord(systemPrompt: string, memData: UserMemoryData): string {
  const { possibilities, sureties } = memData;
  const hasAny = possibilities || sureties;
  if (!hasAny) {
    return `${systemPrompt}\n\nuser record: new user. no record yet.`;
  }

  const lines: string[] = ["\n\nuser record:"];

  if (sureties) {
    lines.push(
      "[confirmed facts — more reliable, but still open to correction if the user updates you]",
      sureties,
    );
  }

  if (possibilities) {
    lines.push(
      "[inferred / unconfirmed — picked up from conversation patterns; use carefully for personalization, don't assert as fact, stay open to being wrong]",
      possibilities,
    );
  }

  return systemPrompt + lines.join("\n");
}

function withModeOverride(systemPrompt: string, modeInstruction?: string): string {
  if (!modeInstruction) return systemPrompt;
  return `${systemPrompt}\n\nACTIVE MODE OVERRIDE — apply this on top of your normal personality for every request type:\n${modeInstruction}`;
}

function recordUserSessionExchange(userId: string, userContent: string, assistantContent: string): void {
  const history = userSessionHistories.get(userId) ?? [];
  history.push({ role: "user", content: userContent });
  history.push({ role: "assistant", content: assistantContent });
  if (history.length > 30) history.splice(0, history.length - 30);
  userSessionHistories.set(userId, history);
}

function sanitizeDossier(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(username|user name|discord|role|roles|id|server)\b/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.split(/\s+/).filter(Boolean).slice(0, 200).join(" ");
}

function isSubstantialMemoryMessage(content: string): boolean {
  const text = content
    .toLowerCase()
    .replace(/'/g, "'")
    .replace(/<@!?\d+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();

  if (text.length < 8) {
    return false;
  }

  const isThrowaway = /^(hi|hello|hey|thanks|thank you|ty|ok|okay|lol|lmao|roast me|help|what|why|how|when|where|who)\b/.test(text) && text.length < 30;
  if (isThrowaway) return false;

  const hasSelfReference = /\b(i|im|ive|id|my|me|mine|myself|we|our|us)\b/.test(text) || /\bi'm\b|\bi've\b|\bi'd\b/.test(text);

  const hasMajorLifeSignal = /\b(failed?|passed?|exam|tests?|maths?|grades?|school|college|university|cat|dog|pet|died|dead|death|lost|grief|sad|depressed|anxious|stressed|panic|hospital|sick|ill|diagnosed|injured|breakup|broke up|girlfriend|boyfriend|crush|friends?|mom|mum|mother|dad|father|parents?|family|job|work|fired|hired|quit|moved|moving|birthday|won|achievement|trauma|bullied|arrested|pregnant|engaged|married|divorced|cheated|surgery|overdose|rehab|expelled|suspended|homeless|evicted|debt|bankrupt|dropout|graduated|scholarship|promotion|raise|relocated|deployed|retired)\b/.test(text);

  const hasNuancedSignal = /\b(hate|love|obsessed|addicted|favorite|favourite|prefer|always|never|usually|everyday|hobby|hobbies|passion|dream|goal|plan|afraid|scared|nervous|excited|wish|hope|regret|miss|proud|ashamed|embarrassed|lonely|bored|tired|exhausted|insomnia|diet|vegan|vegetarian|allergic|allergy|religion|religious|spiritual|atheist|political|conservative|liberal|vote|gaming|gamer|music|band|artist|film|show|book|reading|writing|drawing|coding|sport|gym|workout|fitness|studying|major|degree|career|income|salary|rent|apartment|house|city|country|nationality|language|accent|culture|heritage|identity|gender|sexuality|therapy|therapist|medication|meds|adhd|autism|bipolar|ocd|anime|manga|weeb|competitive|ranked|grinding|streamer|content creator|entrepreneur|freelance|remote|side hustle|night shift|introvert|extrovert|neurodivergent)\b/.test(text);

  const hasOpinionOrPreference = /\b(i think|i believe|i feel|i want|i need|i wish|i hope|i hate|i love|i like|i enjoy|i prefer|i always|i never|i usually|my favorite|my favourite|my dream|my goal|my name|i go to|i work|i live|i'm from|i grew up|i'm into|i'm a|i've been|i used to|i started|i stopped|i'm trying|i'm learning|i'm working on|i'm playing|i'm watching|i'm reading|i'm dealing with)\b/.test(text);

  const hasPersonalContext = hasSelfReference && (hasMajorLifeSignal || hasNuancedSignal || hasOpinionOrPreference);
  const hasStrongStatement = !hasSelfReference && (hasMajorLifeSignal || (hasNuancedSignal && text.length > 30));

  return hasPersonalContext || hasStrongStatement;
}

function getSubstantialMemorySnippet(history: HistoryEntry[]): string {
  return history
    .filter((entry) => entry.role === "user")
    .slice(-8)
    .map((entry) => entry.content.slice(0, 600).trim())
    .filter(isSubstantialMemoryMessage)
    .slice(-4)
    .join("\n");
}

export function triggerUserMemoryUpdate(userId: string): void {
  const history = userSessionHistories.get(userId) ?? [];
  const substantialSnippet = getSubstantialMemorySnippet(history);
  const previousCandidate = processedMemoryCandidates.get(userId);

  if (!substantialSnippet || previousCandidate === substantialSnippet || pendingMemoryUpdates.has(userId)) {
    return;
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    log("[Memory] GROQ_API_KEY not set — skipping memory update.", "gemini");
    return;
  }

  processedMemoryCandidates.set(userId, substantialSnippet);
  pendingMemoryUpdates.add(userId);
  void (async () => {
    try {
      const client = getGroqClient();
      const existing = await getUserMemoryData(userId);

      const systemPrompt = [
        "You maintain a two-tier long-term memory record for a Discord user. Your job is to update BOTH tiers based on what the user has said.",
        "",
        "TIER 1 — POSSIBILITIES (inferred, unconfirmed):",
        "Capture durable, personally useful signals from the user's own words. Include:",
        "- Major life facts: failures, losses, grief, school/work setbacks, health issues, relationships, pets, trauma, worries, achievements, transitions.",
        "- Nuanced personal details: preferences, hobbies, recurring topics, opinions held firmly, places they frequent, people important to them (by relationship not name), habits, lifestyle choices (diet, sleep, fitness, gaming), identity (nationality, religion, sexuality if stated), career/study focus, media tastes mentioned more than once, emotional patterns.",
        "These are INFERRED. The bot will use them carefully without asserting them as facts.",
        "Max 150 words. Lowercase plain prose. No bullets or headers.",
        "",
        "TIER 2 — SURETIES (confirmed, higher-confidence facts):",
        "Promote items from Possibilities ONLY when the user has explicitly confirmed, directly stated, or repeatedly reinforced them across conversations.",
        "A surety is something the user has stated as definite first-person fact — e.g., their birthday, that they have a child, their age, their job title, that they live somewhere specific — not something inferred from behavior.",
        "A surety can also be promoted from Possibilities if the user explicitly corrects an inference ('no, i actually do X') or confirms it ('yeah exactly, i am X').",
        "Sureties are more reliable but NOT permanent — update or remove them if the user contradicts or corrects them.",
        "Max 80 words. Lowercase plain prose. No bullets or headers. Keep it very sparse — most users will have few or no sureties.",
        "",
        "RULES FOR BOTH TIERS:",
        "- Do not store: usernames, Discord roles/IDs, server names, generic tech specs, throwaway chatter, bot commands, jokes, or assistant opinions.",
        "- Never invent facts not present in the messages.",
        "- If nothing has changed in a tier, return the existing content for that tier unchanged.",
        "- If a tier has no content, output an empty string for it.",
        "",
        "OUTPUT FORMAT — return EXACTLY this structure, no extra text:",
        "POSSIBILITIES:",
        "<updated possibilities text or empty>",
        "SURETIES:",
        "<updated sureties text or empty>",
      ].join("\n");

      const userContent = [
        `existing possibilities:\n${existing.possibilities || "(none)"}`,
        `existing sureties:\n${existing.sureties || "(none)"}`,
        `new user message(s):\n${substantialSnippet}`,
      ].join("\n\n");

      const completion = await client.chat.completions.create({
        model: MEMORY_UPDATE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.2,
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";

      const possibilitiesMatch = raw.match(/POSSIBILITIES:\s*([\s\S]*?)(?=\nSURETIES:|$)/i);
      const suretiesMatch = raw.match(/SURETIES:\s*([\s\S]*)$/i);

      const newPossibilities = sanitizeDossier(possibilitiesMatch?.[1]?.trim() ?? "");
      const newSureties = sanitizeDossier(suretiesMatch?.[1]?.trim() ?? "");

      const possibilitiesChanged = newPossibilities && newPossibilities !== sanitizeDossier(existing.possibilities);
      const suretiesChanged = newSureties !== sanitizeDossier(existing.sureties || "");

      if (!possibilitiesChanged && !suretiesChanged) {
        log("[Memory] Both tiers unchanged — skipping database write.", "gemini");
        return;
      }

      await storage.upsertUserMemory(
        userId,
        newPossibilities || existing.possibilities,
        newSureties,
      );
      log(`[Memory] Updated — possibilities: ${possibilitiesChanged ? "changed" : "same"}, sureties: ${suretiesChanged ? "changed" : "same"}.`, "gemini");
    } catch (err: any) {
      log(`[Memory] Update failed: ${err.message}`, "gemini");
    } finally {
      pendingMemoryUpdates.delete(userId);
    }
  })();
}

function getGeminiHistory(history: HistoryEntry[]) {
  const normalized = [...history];

  while (normalized.length > 0 && normalized[0]?.role !== "user") {
    normalized.shift();
  }

  return normalized.map((entry) => ({
    role: entry.role === "assistant" ? "model" : "user",
    parts: [{ text: entry.content }],
  }));
}

function isSafetyBlockedError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("safety") ||
    normalized.includes("blocked") ||
    normalized.includes("content policy") ||
    normalized.includes("candidate")
  );
}

function sanitizeReply(text: string): string {
  return text
    .replace(/^fred\s*(says?|:)\s*/i, "")
    .replace(/^["]+|["]+$/g, "")
    .split("\n")
    .map((line) => line.replace(/^["]+|["]+$/g, "").trim())
    .join("\n")
    .trim();
}

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set.");
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

function getGroqClient(): Groq {
  if (!groqClient) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY is not set.");
    groqClient = new Groq({ apiKey: key });
  }
  return groqClient;
}

function resolveAuthorityLevel(roles: string[], isOwner: boolean): string {
  if (isOwner || roles.some((r) => r.trim().toLowerCase() === "owner")) return "owner";
  if (roles.some((r) => /^(moderator|mod)$/i.test(r.trim()))) return "moderator";
  if (roles.some((r) => /^(developer|dev|in.house.dev)$/i.test(r.trim()))) return "developer";
  return "member";
}

function buildUserPrompt(userMessage: string, authorName: string, context: AuthorContext = {}, channelContext?: string): string {
  const roles = context.roles?.filter(Boolean) ?? [];
  const hasOwnerRole = roles.some((role) => role.trim().toLowerCase() === "owner");
  const isOwner = context.isOwner || hasOwnerRole;
  const authorityLevel = resolveAuthorityLevel(roles, isOwner);

  const sortedRoles = context.sortedRoles ?? roles;
  const roleText = sortedRoles.length > 0 ? sortedRoles.join(" > ") : "none";

  const parts: string[] = [
    `server: ${context.guildName ?? "unknown server"}`,
    `channel: #${context.channelName ?? "unknown"}`,
    `speaker: ${authorName}`,
    `roles (highest → lowest): ${roleText}`,
    `authority level: ${authorityLevel}`,
  ];

  if (channelContext) {
    parts.push(`recent chat context:\n${channelContext}`);
  }

  if (context.replyTo) {
    parts.push(`replying to message: ${context.replyTo}`);
  }

  parts.push(`message: ${userMessage}`);

  return parts.join("\n");
}

async function tryGroq(prompt: string, history: HistoryEntry[], systemPrompt: string): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    log("[Groq] GROQ_API_KEY not set — skipping.", "gemini");
    return null;
  }

  const client = getGroqClient();
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: prompt },
  ];

  for (const modelName of GROQ_MODELS_TO_TRY) {
    try {
      log(`[Groq] Trying model: ${modelName}`, "gemini");

      const completion = await client.chat.completions.create({
        model: modelName,
        messages,
        max_tokens: 1024,
        temperature: 0.78,
      });

      const text = sanitizeReply(completion.choices[0]?.message?.content?.trim() ?? "");

      if (text === "SKIP") {
        log("[Groq] Filtered message — returning in-character refusal.", "gemini");
        return getForbiddenResponse();
      }

      const tokens = (completion as GroqChatCompletion).usage?.total_tokens ?? 0;
      stats.totalTokens.groq += tokens;
      stats.lastUsedProvider = "Groq";
      stats.lastUsedModel = modelName;
      stats.totalRequests++;

      log(`[Groq] Success with model ${modelName}`, "gemini");
      return text;
    } catch (err: any) {
      const msg = err.message ?? String(err);
      if (isSafetyBlockedError(msg)) {
        log("[Groq] Safety blocked content — returning in-character refusal.", "gemini");
        return getForbiddenResponse();
      }
      log(`[Groq] Model ${modelName} failed: ${msg}`, "gemini");
      continue;
    }
  }

  log("[Groq] All models failed.", "gemini");
  return null;
}

async function tryHackclub(prompt: string, history: HistoryEntry[], systemPrompt: string): Promise<string | null> {
  const key = process.env.HACKCLUB_API_KEY;
  if (!key) {
    log("[Hackclub] HACKCLUB_API_KEY not set — skipping.", "gemini");
    return null;
  }

  try {
    log(`[Hackclub] Trying model: ${HACKCLUB_MODEL}`, "gemini");
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: prompt },
    ];

    const response = await fetch(`${HACKCLUB_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: HACKCLUB_MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0.78,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      log(`[Hackclub] HTTP ${response.status}: ${errText}`, "gemini");
      return null;
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = sanitizeReply(data.choices?.[0]?.message?.content?.trim() ?? "");

    if (text === "SKIP") {
      log("[Hackclub] Filtered message — returning in-character refusal.", "gemini");
      return getForbiddenResponse();
    }

    const tokens = (data as any).usage?.total_tokens ?? 0;
    stats.totalTokens.hackclub += tokens;
    stats.lastUsedProvider = "Grok (Hackclub)";
    stats.lastUsedModel = HACKCLUB_MODEL;
    stats.totalRequests++;

    log(`[Hackclub] Success with model ${HACKCLUB_MODEL}`, "gemini");
    return text;
  } catch (err: any) {
    const msg = err.message ?? String(err);
    log(`[Hackclub] Error: ${msg}`, "gemini");
    return null;
  }
}

export interface ImageData {
  mimeType: string;
  data: string;
}

export async function askGeminiWithImage(
  userMessage: string,
  authorName: string,
  channelId: string,
  images: ImageData[],
  context: AuthorContext = {}
): Promise<string | null> {
  const channelCtx = getFormattedChannelContext(channelId);
  const prompt = buildUserPrompt(userMessage || "what do you think of this?", authorName, context, channelCtx || undefined);
  const history = getHistory(channelId);
  const userId = getMemoryUserId(authorName, context);
  const memData = await getUserMemoryData(userId);
  const baseSystemPrompt = withUserRecord(await buildSharedSystemPrompt(), memData);
  const systemPrompt = withModeOverride(baseSystemPrompt, context.modeInstruction);
  const mediaGuide = [
    "",
    "MEDIA ANALYSIS RULES — follow these exactly. accuracy over confidence, always.",
    "",
    "CORE PRINCIPLE — describe what you actually see, then cautiously interpret:",
    "step 1: describe the literal visual content — what subjects, objects, actions, colors, text are actually visible",
    "step 2: only THEN make interpretations (source, character name, meme name) — and only if you are genuinely confident",
    "never skip step 1 to jump straight to an interpretation. never invent visual details you cannot see.",
    "",
    "STATIC IMAGES:",
    "- describe what is actually in the frame: people, objects, setting, any visible text",
    "- if you recognize a face, character, meme format, or logo with high confidence: name it",
    "- if you're only partially sure: say 'looks like', 'might be', 'i think that's' — do not state it as fact",
    "- if you cannot tell what something is: say that. do not fill the gap with a guess stated as fact",
    "",
    "ANIMATED GIFs:",
    "- gifs are short looping clips. describe the motion and action — what is actually happening visually",
    "- describe the sequence of events you can see. do not invent motion that isn't there",
    "- if you recognize the source (show, movie, game, meme): say so, but only if you're confident. 'i think this is from [X]' is better than wrong-and-certain",
    "- read any visible text or captions accurately. do not paraphrase or misquote text you can see",
    "- if the gif is too compressed or small to read clearly: say 'can't make out the text' rather than guessing",
    "- do not narrate actions you cannot see. stick to what is visually happening",
    "",
    "TENOR/EMBEDDED GIFs (often arrive as mp4/gifv):",
    "- treat as reaction gifs. describe what's happening in the clip and the emotion it's conveying",
    "- if you can identify the source character or show: mention it, with appropriate confidence level",
    "",
    "VIDEOS:",
    "- describe what actually happens. do not fill gaps in understanding with invented context",
    "- if the video is unclear or you can only see part of the action: say so",
    "",
    "HONESTY RULES FOR VISUAL MEDIA (non-negotiable):",
    "- if the image is too blurry, too small, too compressed, or too low quality to analyze properly: say 'can't really make this out, too blurry/small — what is it?'",
    "- if you are not sure what something is: 'not sure what i'm looking at here' is a valid answer",
    "- NEVER confidently name a character, show, person, or meme if you are not actually sure. a wrong confident ID is far worse than an honest 'not sure'",
    "- 'i think that might be [X] but i could be wrong' is always better than '[X]' when you're uncertain",
    "- your personality stays on. the honesty rules also stay on. both at once.",
  ].join("\n");

  const fullSystemPrompt = systemPrompt + mediaGuide;

  if (geminiEnabled) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const client = getClient();

      for (const modelName of MODELS_TO_TRY) {
        try {
          log(`[Gemini] Trying model: ${modelName} (with image)`, "gemini");
          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction: fullSystemPrompt,
            generationConfig: { temperature: 0.4 },
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            ],
          });

          const contentParts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
            ...images.map((img) => ({
              inlineData: { mimeType: img.mimeType, data: img.data },
            })),
            { text: prompt },
          ];

          const result = await model.generateContent(contentParts);
          const text = sanitizeReply(result.response.text().trim());

          if (text === "SKIP") {
            log(`[Gemini] Filtered image message from ${authorName} — returning in-character refusal.`, "gemini");
            return getForbiddenResponse();
          }

          const tokens = result.response.usageMetadata?.totalTokenCount ?? 0;
          stats.totalTokens.gemini += tokens;
          stats.lastUsedProvider = "Gemini";
          stats.lastUsedModel = modelName;
          stats.totalRequests++;

          log(`[Gemini] Image analysis success with model ${modelName}`, "gemini");
          pushHistory(channelId, "user", prompt);
          pushHistory(channelId, "assistant", text);
          recordUserSessionExchange(userId, prompt, text);
          return text;
        } catch (err: any) {
          const msg: string = err.message ?? "";
          const isQuota = msg.includes("429") || msg.includes("quota");
          const isNotFound = msg.includes("404") || msg.includes("not found");
          const isSafetyBlocked = isSafetyBlockedError(msg);

          if (isQuota || isNotFound) {
            log(`[Gemini] Model ${modelName} failed (${isQuota ? "quota" : "not found"}) — trying next.`, "gemini");
            continue;
          }

          if (isSafetyBlocked) {
            log("[Gemini] Safety blocked image content — returning in-character refusal.", "gemini");
            return getForbiddenResponse();
          }

          log(`[Gemini] Image error: ${msg} — trying next model.`, "gemini");
          continue;
        }
      }

      log("[Gemini] All models exhausted for image — falling back to text-only.", "gemini");
    } else {
      log("[Gemini] GEMINI_API_KEY not set — falling back to text-only.", "gemini");
    }
  } else {
    log("[Gemini] Disabled — falling back to text-only.", "gemini");
  }

  if (userMessage && userMessage.trim()) {
    log("[Gemini] Image fallback — responding to text portion only via Groq/Hackclub.", "gemini");
    return askGemini(userMessage, authorName, channelId, context);
  }

  const imageOnlyFallbacks = [
    "gemini's down and i can't see images without it. describe what you sent if you want my take.",
    "can't see that right now, gemini's being dramatic. tell me what it is in words.",
    "vision's offline. gemini owes me an apology. what was the image.",
    "blind mode activated. gemini's out. type out what you sent.",
  ];
  return imageOnlyFallbacks[Math.floor(Math.random() * imageOnlyFallbacks.length)];
}

export async function askGemini(userMessage: string, authorName: string, channelId: string, context: AuthorContext = {}): Promise<string | null> {
  const channelCtx = getFormattedChannelContext(channelId);
  const prompt = buildUserPrompt(userMessage, authorName, context, channelCtx || undefined);
  const history = getHistory(channelId);
  const userId = getMemoryUserId(authorName, context);
  const memData = await getUserMemoryData(userId);
  const baseSystemPrompt = withUserRecord(await buildSharedSystemPrompt(), memData);
  const systemPrompt = withModeOverride(baseSystemPrompt, context.modeInstruction);

  log("[Text] Routing to Groq (primary).", "gemini");

  if (groqEnabled) {
    const reply = await tryGroq(prompt, history, systemPrompt);
    if (reply) {
      pushHistory(channelId, "user", prompt);
      pushHistory(channelId, "assistant", reply);
      recordUserSessionExchange(userId, prompt, reply);
      return reply;
    }
    log("[Groq] Failed or unavailable — falling back to Gemini (text).", "gemini");
  } else {
    log("[Groq] Disabled — falling back to Gemini (text).", "gemini");
  }

  if (geminiEnabled) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const client = getClient();
      for (const modelName of MODELS_TO_TRY) {
        try {
          log(`[Gemini/text-fallback] Trying model: ${modelName}`, "gemini");
          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            ],
          });
          const chat = model.startChat({ history: getGeminiHistory(history) });
          const result = await chat.sendMessage(prompt);
          const text = sanitizeReply(result.response.text().trim());
          if (text === "SKIP") {
            log("[Gemini/text-fallback] Filtered — returning in-character refusal.", "gemini");
            return getForbiddenResponse();
          }
          const tokens = result.response.usageMetadata?.totalTokenCount ?? 0;
          stats.totalTokens.gemini += tokens;
          stats.lastUsedProvider = "Gemini";
          stats.lastUsedModel = modelName;
          stats.totalRequests++;
          log(`[Gemini/text-fallback] Success with model ${modelName}`, "gemini");
          pushHistory(channelId, "user", prompt);
          pushHistory(channelId, "assistant", text);
          recordUserSessionExchange(userId, prompt, text);
          return text;
        } catch (err: any) {
          const msg: string = err.message ?? "";
          const isQuota = msg.includes("429") || msg.includes("quota");
          const isNotFound = msg.includes("404") || msg.includes("not found");
          const isRoleOrder = msg.includes("First content should be with role 'user'");
          if (isQuota || isNotFound) { log(`[Gemini/text-fallback] Model ${modelName} failed — trying next.`, "gemini"); continue; }
          if (isRoleOrder) { clearHistory(channelId); continue; }
          if (isSafetyBlockedError(msg)) { return getForbiddenResponse(); }
          log(`[Gemini/text-fallback] Error: ${msg} — trying next model.`, "gemini");
          continue;
        }
      }
      log("[Gemini/text-fallback] All models exhausted — falling back to Hackclub.", "gemini");
    } else {
      log("[Gemini] No GEMINI_API_KEY — falling back to Hackclub.", "gemini");
    }
  } else {
    log("[Gemini] Disabled — falling back to Hackclub.", "gemini");
  }

  if (!hackclubEnabled) {
    log("[Hackclub] Disabled — all providers exhausted.", "gemini");
  } else {
    const hackReply = await tryHackclub(prompt, history, systemPrompt);
    if (hackReply) {
      pushHistory(channelId, "user", prompt);
      pushHistory(channelId, "assistant", hackReply);
      recordUserSessionExchange(userId, prompt, hackReply);
      return hackReply;
    }
    log("[Hackclub] Failed — all providers exhausted.", "gemini");
  }

  const allFailedResponses = [
    "all my ai backends are being garbage right now. try again in a bit.",
    "gemini's dead, groq's dead, grok's dead. i got nothing. try later.",
    "every single provider just failed me. unprecedented levels of uselessness. try again.",
    "i'm completely offline right now. not by choice. try again in a minute.",
  ];
  return allFailedResponses[Math.floor(Math.random() * allFailedResponses.length)];
}

const QOTD_OPEN_PROMPT = `Generate a single Question of the Day for a Discord server. Requirements:
- Open-ended (NOT yes/no, NOT two-choice)
- Relevant to a Gen-Z/community Discord audience: gaming, anime/JJBA, internet culture, friendships, school/work, weird hypotheticals, harmless drama, taste debates, or current online culture
- Funny, chaotic, mildly controversial, absurd, or genuinely thought-provoking without being random
- Could be a hypothetical, unpopular opinion prompt, weird scenario, moral dilemma, or taste debate
- Should spark discussion and multiple different answers
- Avoid generic interview questions like "what's your favorite color" or stale icebreakers
- Keep it to 1-2 sentences max
Reply with ONLY the question itself. No quotation marks, no intro text, no explanation.`;

const QOTD_POLL_PROMPT = `Generate a "would you rather" or "this or that" question for a Discord poll. Requirements:
- Exactly TWO choices only
- Relevant to a Gen-Z/community Discord audience: gaming, anime/JJBA, internet culture, friendships, school/work, weird hypotheticals, harmless drama, taste debates, or current online culture
- Funny, chaotic, mildly controversial, absurd, or mildly spicy without being random
- Both options should feel like genuine dilemmas — no obvious right answer
- Avoid generic stale choices like cats vs dogs, pizza vs burgers, or morning vs night
- Keep each option short (under 55 characters)
Reply with ONLY valid JSON in this exact format, no markdown, no code blocks:
{"question":"...","optionA":"...","optionB":"..."}`;

export async function generateForQotd(type: "open" | "poll"): Promise<string | null> {
  const prompt = type === "open" ? QOTD_OPEN_PROMPT : QOTD_POLL_PROMPT;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const client = getClient();
    for (const modelName of MODELS_TO_TRY) {
      try {
        const model = client.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = sanitizeReply(result.response.text().trim());
        if (text) {
          log(`[QOTD] Generated ${type} via Gemini (${modelName})`, "qotd");
          return text;
        }
      } catch (err: any) {
        const msg = err.message ?? "";
        if (msg.includes("429") || msg.includes("quota") || msg.includes("404")) continue;
        log(`[QOTD] Gemini error: ${msg}`, "qotd");
        continue;
      }
    }
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const client = getGroqClient();
    for (const modelName of GROQ_MODELS_TO_TRY) {
      try {
        const completion = await client.chat.completions.create({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
          temperature: 1.1,
        });
        const text = sanitizeReply(completion.choices[0]?.message?.content?.trim() ?? "");
        if (text) {
          log(`[QOTD] Generated ${type} via Groq (${modelName})`, "qotd");
          return text;
        }
      } catch (err: any) {
        log(`[QOTD] Groq model ${modelName} failed: ${err.message}`, "qotd");
        continue;
      }
    }
  }

  log(`[QOTD] All providers failed for type: ${type}`, "qotd");
  return null;
}

const NEWS_FEEDS: Record<"memes" | "popculture" | "music" | "gaming" | "anime" | "worldpolitics" | "uspolitics", string[]> = {
  memes: [
    "https://www.reddit.com/r/memes/.rss",
    "https://www.reddit.com/r/dankmemes/.rss",
    "https://www.reddit.com/r/OutOfTheLoop/.rss",
    "https://knowyourmeme.com/newsfeed.rss",
  ],
  popculture: [
    "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    "https://variety.com/feed/",
    "https://deadline.com/feed/",
    "https://people.com/feed/",
    "https://www.reddit.com/r/popculturechat/.rss",
  ],
  music: [
    "https://pitchfork.com/feed/feed-news/rss",
    "https://www.rollingstone.com/feed/",
    "https://www.billboard.com/feed/",
    "https://hiphopdx.com/feed",
  ],
  gaming: [
    "https://www.polygon.com/rss/index.xml",
    "https://www.ign.com/rss/news.xml",
    "https://www.gamespot.com/feeds/news/",
    "https://www.reddit.com/r/gaming/.rss",
  ],
  anime: [
    "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us",
    "https://www.crunchyroll.com/news/rss",
    "https://www.reddit.com/r/anime/.rss",
  ],
  worldpolitics: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.theguardian.com/world/rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://feeds.aljazeera.com/aljazeera/stories",
  ],
  uspolitics: [
    "https://feeds.bbci.co.uk/news/politics/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
    "https://www.theguardian.com/us-news/rss",
    "https://feeds.npr.org/1014/rss.xml",
  ],
};

export { NEWS_FEEDS };

export async function fetchRssHeadlines(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FredBot/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = xml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g) ?? [];
    return matches
      .map((m) => m.replace(/<title>(?:<!\[CDATA\[)?/, "").replace(/(?:\]\]>)?<\/title>/, "").trim())
      .filter((t) => t.length > 10 && t.length < 200)
      .slice(1, 9);
  } catch {
    return [];
  }
}

export async function generateBotStatus(): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const categories: Array<keyof typeof NEWS_FEEDS> = [
    "memes",
    "memes",
    "memes",
    "popculture",
    "popculture",
    "music",
    "gaming",
    "anime",
    "worldpolitics",
    "uspolitics",
  ];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const feeds = NEWS_FEEDS[category];
  const feedUrl = feeds[Math.floor(Math.random() * feeds.length)];

  const headlines = await fetchRssHeadlines(feedUrl);

  if (headlines.length < 2) {
    const allFeeds = categories.flatMap((name) => NEWS_FEEDS[name]);
    for (const fallbackUrl of allFeeds) {
      if (fallbackUrl === feedUrl) continue;
      const fallbackHeadlines = await fetchRssHeadlines(fallbackUrl);
      if (fallbackHeadlines.length >= 2) {
        headlines.push(...fallbackHeadlines);
        break;
      }
    }
  }

  if (headlines.length === 0) return null;

  try {
    const client = getGroqClient();
    const completion = await client.chat.completions.create({
      model: MEMORY_UPDATE_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "You write Discord bot custom statuses for a Gen-Z Discord server.",
            "Given current meme/news headlines, write one sharp, funny take as a custom status.",
            "Default focus: recent memes people are joking about, viral internet bits, pop culture chaos, gaming, anime, music, celebrity drama, and dumb timeline discourse.",
            "Politics should be rare. Only use political headlines if something substantial or unavoidable happened; do not make routine politics the main vibe.",
            "Tone: sharp, casual, internet-literate, dry, amused — not tryhard, not corporate, not a news summary.",
            "Use meme references naturally when they fit: cooked, aura, side quest, lore drop, main character, speedrun, canon event, npc behavior, generational run, or similar current internet language.",
            "Rules: all lowercase, one line only, max 75 characters, no hashtags, no quotes, no slurs, no explicit sexual content.",
            "Emojis: only use one emoji if it genuinely fits — do NOT force one in every status. When you do use one, pick from: 😭 💀 ✌🏻 💔 🙏🏻",
            "Reference or riff on a specific headline detail, make it sound like something a real person would put as their status.",
            "Output only the status text, nothing else.",
          ].join(" "),
        },
        {
          role: "user",
          content: `current headlines (${category}):\n${headlines.join("\n")}`,
        },
      ],
      max_tokens: 48,
      temperature: 1.05,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const status = raw.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!status || status.length < 5 || status.length > 75) return null;
    log(`[Status] AI generated status from ${category} feed: ${status}`, "gemini");
    return status;
  } catch (err: any) {
    log(`[Status] AI generation failed: ${err.message}`, "gemini");
    return null;
  }
}
