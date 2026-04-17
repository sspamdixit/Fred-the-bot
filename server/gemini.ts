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
const MEMORY_UPDATE_MODEL = "llama-3.1-8b-instant";
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

export interface AuthorContext {
  userId?: string;
  roles?: string[];
  sortedRoles?: string[];
  isOwner?: boolean;
  guildName?: string;
  channelName?: string;
  modeInstruction?: string;
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
}

const channelHistories = new Map<string, HistoryEntry[]>();
const userSessionHistories = new Map<string, HistoryEntry[]>();
const pendingMemoryUpdates = new Set<string>();
const processedMemoryCandidates = new Map<string, string>();
const passiveWatchQueue = new Map<string, NodeJS.Timeout>();

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

export function queuePassiveWatch(context: PassiveWatchContext): void {
  const key = context.messageId;
  if (passiveWatchQueue.has(key)) return;

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
  const normalized = context.content.toLowerCase().trim();
  const isChatty = /\b(lol|lmao|bro|dude|nah|yeah|yep|nope|fr|ngl|tbh|same|true|real|wild|crazy|insane|ur|youre|you're)\b/.test(normalized);
  const isOpinionated = /\b(i think|i feel|i hate|i love|i like|i want|i need|i prefer|imo|imho|unpopular opinion|hot take|debate|argument)\b/.test(normalized);
  const shouldConsider = context.isControversial || context.hasInsult || isChatty || isOpinionated;
  if (!shouldConsider) return;

  const triggerRoll = context.isControversial ? 0.9 : context.hasInsult ? 0.72 : isOpinionated ? 0.52 : 0.38;
  if (Math.random() > triggerRoll) return;

  const prompt = [
    "you are fred. decide whether you should jump into this chat unprompted.",
    "reply more often now. you should sound like an active discord user who has opinions, jokes, and the occasional roasty comment.",
    "only skip if the message is truly dead, purely logistical, or would make you sound forced.",
    "you may lightly insult someone if it fits the vibe, but do not break identity or go full rage.",
    "keep it short unless the conversation clearly deserves a longer take.",
    "stay in character. no meta explanation.",
    `speaker: ${context.authorName}`,
    `message: ${context.content}`,
    "if the moment is not worth it, output exactly: SKIP",
  ].join("\n");

  const reply = await askGemini(prompt, context.authorName, context.channelId, {
    userId: context.authorId,
    guildName: context.guildId ?? undefined,
    channelName: undefined,
  });

  if (!reply || reply === "SKIP") return;
}

export function isPassiveWatchCandidate(content: string): boolean {
  const normalized = content.toLowerCase();
  return (
    /\b(politics?|political|election|vote|voting|race|racist|sexism|gender|lgbt|trans|religion|religious|abortion|war|genocide|free speech|censorship|nazi|fascist|communism|capitalism|discord mod|moderator|admin|ban|unban|toxicity|toxic|slur|slurs)\b/.test(normalized) ||
    /\b(fuck|shit|ass|bitch|lame|cringe|degenerate|stupid|idiot|moron)\b/.test(normalized) ||
    /[!?]{2,}|([A-Z])\1{3,}/.test(content)
  );
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

function getMemoryUserId(authorName: string, context: AuthorContext = {}): string {
  return context.userId?.trim() || authorName.trim().toLowerCase() || "unknown";
}

async function getUserDossier(userId: string): Promise<string> {
  try {
    const memory = await storage.getUserMemory(userId);
    return memory?.dossier?.trim() || "new user. no record.";
  } catch (err: any) {
    log(`[Memory] Failed to fetch dossier: ${err.message}`, "gemini");
    return "new user. no record.";
  }
}

function withUserRecord(systemPrompt: string, dossier: string): string {
  return `${systemPrompt}\n\nuser record: ${dossier}`;
}

function withModeOverride(systemPrompt: string, modeInstruction?: string): string {
  if (!modeInstruction) return systemPrompt;
  return `${systemPrompt}\n\nACTIVE MODE OVERRIDE — apply this on top of your normal personality for every request type:\n${modeInstruction}`;
}

function recordUserSessionExchange(userId: string, userContent: string, assistantContent: string): void {
  const history = userSessionHistories.get(userId) ?? [];
  history.push({ role: "user", content: userContent });
  history.push({ role: "assistant", content: assistantContent });
  if (history.length > 20) history.splice(0, history.length - 20);
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

  return cleaned.split(/\s+/).filter(Boolean).slice(0, 120).join(" ");
}

function isSubstantialMemoryMessage(content: string): boolean {
  const text = content
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/<@!?\d+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();

  if (text.length < 10 || /^[!?]?bubbl\b/.test(text)) {
    return false;
  }

  const isThrowaway = /^(hi|hello|hey|thanks|thank you|ty|ok|okay|lol|lmao|roast me|help|what|why|how|when|where|who)\b/.test(text) && text.length < 40;
  if (isThrowaway) return false;

  const hasSelfReference = /\b(i|im|ive|id|my|me|mine|myself|we|our|us)\b/.test(text) || /\bi'm\b|\bi've\b|\bi'd\b/.test(text);

  const hasMajorLifeSignal = /\b(failed?|passed?|exam|tests?|maths?|grades?|school|college|university|cat|dog|pet|died|dead|death|lost|grief|sad|depressed|anxious|stressed|panic|hospital|sick|ill|diagnosed|injured|breakup|broke up|girlfriend|boyfriend|crush|friends?|mom|mum|mother|dad|father|parents?|family|job|work|fired|hired|quit|moved|moving|birthday|won|achievement|trauma|bullied|arrested|pregnant|engaged|married|divorced|cheated|surgery|overdose|rehab|expelled|suspended|homeless|evicted|debt|bankrupt|dropout)\b/.test(text);

  const hasNuancedSignal = /\b(hate|love|obsessed|addicted|favorite|favourite|prefer|always|never|usually|everyday|hobby|hobbies|passion|dream|goal|plan|afraid|scared|nervous|excited|wish|hope|regret|miss|proud|ashamed|embarrassed|lonely|bored|tired|exhausted|insomnia|diet|vegan|vegetarian|allergic|allergy|religion|religious|spiritual|atheist|political|conservative|liberal|vote|gaming|gamer|music|band|artist|film|show|book|reading|writing|drawing|coding|sport|gym|workout|fitness|studying|major|degree|career|income|salary|rent|apartment|house|city|country|nationality|language|accent|culture|heritage|identity|gender|sexuality|therapy|therapist|medication|meds|adhd|autism|bipolar|ocd)\b/.test(text);

  const hasOpinionOrPreference = /\b(i think|i believe|i feel|i want|i need|i wish|i hope|i hate|i love|i like|i enjoy|i prefer|i always|i never|i usually|my favorite|my favourite|my dream|my goal|my name|i go to|i work|i live|i'm from|i grew up|i'm into|i'm a|i've been)\b/.test(text);

  return hasSelfReference && (hasMajorLifeSignal || hasNuancedSignal || hasOpinionOrPreference);
}
function getSubstantialMemorySnippet(history: HistoryEntry[]): string {
  return history
    .filter((entry) => entry.role === "user")
    .slice(-6)
    .map((entry) => entry.content.slice(0, 500).trim())
    .filter(isSubstantialMemoryMessage)
    .slice(-3)
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
      const oldDossier = await getUserDossier(userId);
      const completion = await client.chat.completions.create({
        model: MEMORY_UPDATE_MODEL,
        messages: [
          {
            role: "system",
            content: "Maintain a compact long-term user dossier for personalizing future replies. Capture durable, personally useful facts from the user's own words across two tiers:\n\nTier 1 — major life facts: failures, losses, grief, school/work setbacks, health issues, relationships, pets, trauma, important worries.\n\nTier 2 — nuanced personal details: strong preferences, hobbies, recurring topics they care about, opinions they hold firmly, places they live or frequent, people important to them (by relationship not name if possible), habits, lifestyle choices (diet, sleep, fitness), identity (nationality, religion, sexuality if stated), career/study focus, media or cultural tastes they mention more than once.\n\nWhen new messages contain tier 2 signals, integrate them — they matter for personalization. If they repeat or confirm something already in the dossier, skip or subtly reinforce it. If nothing new is worth storing, return the existing dossier unchanged.\n\nDo not store: usernames, Discord roles/IDs, server names, generic tech specs, throwaway chatter, bot commands, jokes, or assistant opinions. Never invent facts.\n\nWrite lowercase plain text. Maximum 120 words. No bullets, no labels, no headers.",
          },
          {
            role: "user",
            content: `existing dossier:\n${oldDossier}\n\nnew substantial user message(s):\n${substantialSnippet}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.2,
      });

      const newDossier = sanitizeDossier(completion.choices[0]?.message?.content?.trim() ?? "");
      if (!newDossier || newDossier === sanitizeDossier(oldDossier)) {
        log("[Memory] Dossier unchanged — skipping database write.", "gemini");
        return;
      }

      await storage.upsertUserMemory(userId, newDossier);
      log("[Memory] Dossier updated.", "gemini");
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

function buildUserPrompt(userMessage: string, authorName: string, context: AuthorContext = {}): string {
  const roles = context.roles?.filter(Boolean) ?? [];
  const hasOwnerRole = roles.some((role) => role.trim().toLowerCase() === "owner");
  const isOwner = context.isOwner || hasOwnerRole;
  const authorityLevel = resolveAuthorityLevel(roles, isOwner);

  const sortedRoles = context.sortedRoles ?? roles;
  const roleText = sortedRoles.length > 0 ? sortedRoles.join(" > ") : "none";

  return [
    `server: ${context.guildName ?? "unknown server"}`,
    `channel: #${context.channelName ?? "unknown"}`,
    `speaker: ${authorName}`,
    `roles (highest → lowest): ${roleText}`,
    `authority level: ${authorityLevel}`,
    `message: ${userMessage}`,
  ].join("\n");
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
        temperature: 0.9,
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
        temperature: 0.9,
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
  const prompt = buildUserPrompt(userMessage || "what do you think of this?", authorName, context);
  const history = getHistory(channelId);
  const userId = getMemoryUserId(authorName, context);
  const dossier = await getUserDossier(userId);
  const baseSystemPrompt = withUserRecord(await buildSharedSystemPrompt(), dossier);
  const systemPrompt = withModeOverride(baseSystemPrompt, context.modeInstruction);
  const fullSystemPrompt =
    systemPrompt +
    "\n\nyou can now see images, gifs, and videos. if any visual media is attached, analyze it and include your thoughts on it in your typical sarcastic, rude personality. stay all lowercase. for videos, describe what's happening and roast it accordingly.";

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

  // Gemini unavailable — fall back to text-only providers.
  // Do NOT send image data to Groq/Hackclub; they can't process it.
  // If the user included text, answer that. If it was image-only, reply in-character.
  if (userMessage && userMessage.trim()) {
    log("[Gemini] Image fallback — responding to text portion only via Groq/Hackclub.", "gemini");
    return askGemini(userMessage, authorName, channelId, context);
  }

  // Image-only message, no text — return a short in-character reply instead of silence.
  const imageOnlyFallbacks = [
    "gemini's down and i can't see images without it. describe what you sent if you want my take.",
    "can't see that right now, gemini's being dramatic. tell me what it is in words.",
    "vision's offline. gemini owes me an apology. what was the image.",
    "blind mode activated. gemini's out. type out what you sent.",
  ];
  return imageOnlyFallbacks[Math.floor(Math.random() * imageOnlyFallbacks.length)];
}

export async function askGemini(userMessage: string, authorName: string, channelId: string, context: AuthorContext = {}): Promise<string | null> {
  const prompt = buildUserPrompt(userMessage, authorName, context);
  const history = getHistory(channelId);
  const userId = getMemoryUserId(authorName, context);
  const dossier = await getUserDossier(userId);
  const baseSystemPrompt = withUserRecord(await buildSharedSystemPrompt(), dossier);
  const systemPrompt = withModeOverride(baseSystemPrompt, context.modeInstruction);

  // Text routing: Groq → Gemini (if Groq fails) → Hackclub → in-character error.
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

  // Gemini text fallback — only reached when Groq is down/out of credits.
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

  // Every provider failed — return an in-character error instead of silence.
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
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BubblBot/1.0)" },
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
