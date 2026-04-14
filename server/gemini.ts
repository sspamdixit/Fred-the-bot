import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import Groq from "groq-sdk";
import type { ChatCompletion as GroqChatCompletion } from "groq-sdk/resources/chat/completions";
import { log } from "./index";
import { buildSharedSystemPrompt } from "./ai-settings";

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
];

const GROQ_MODEL = "llama-3.3-70b-versatile";
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
  roles?: string[];
  isOwner?: boolean;
}

const channelHistories = new Map<string, HistoryEntry[]>();

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

function buildUserPrompt(userMessage: string, authorName: string, context: AuthorContext = {}): string {
  const roles = context.roles?.filter(Boolean) ?? [];
  const normalizedName = authorName.trim().toLowerCase();
  const hasOwnerRole = roles.some((role) => role.trim().toLowerCase() === "owner");
  const isDeliv3r = normalizedName === "deliv3r";
  const isOwner = context.isOwner || hasOwnerRole || isDeliv3r;
  const roleText = roles.length > 0 ? roles.join(", ") : "none";
  const ownerText = isOwner ? "yes" : "no";

  return [
    `speaker: ${authorName}`,
    `discord roles: ${roleText}`,
    `owner authority: ${ownerText}`,
    `message: ${userMessage}`,
  ].join("\n");
}

async function tryGroq(prompt: string, history: HistoryEntry[]): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    log("[Groq] GROQ_API_KEY not set — skipping.", "gemini");
    return null;
  }

  try {
    log(`[Groq] Trying model: ${GROQ_MODEL}`, "gemini");
    const client = getGroqClient();
    const systemPrompt = await buildSharedSystemPrompt();

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: prompt },
    ];

    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      max_tokens: 256,
      temperature: 0.9,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";

    if (text === "SKIP") {
      log("[Groq] Filtered message — returning in-character refusal.", "gemini");
      return getForbiddenResponse();
    }

    const tokens = (completion as GroqChatCompletion).usage?.total_tokens ?? 0;
    stats.totalTokens.groq += tokens;
    stats.lastUsedProvider = "Groq";
    stats.lastUsedModel = GROQ_MODEL;
    stats.totalRequests++;

    log(`[Groq] Success with model ${GROQ_MODEL}`, "gemini");
    return text;
  } catch (err: any) {
    const msg = err.message ?? String(err);
    if (isSafetyBlockedError(msg)) {
      log("[Groq] Safety blocked content — returning in-character refusal.", "gemini");
      return getForbiddenResponse();
    }
    log(`[Groq] Error: ${msg}`, "gemini");
    return null;
  }
}

async function tryHackclub(prompt: string, history: HistoryEntry[]): Promise<string | null> {
  const key = process.env.HACKCLUB_API_KEY;
  if (!key) {
    log("[Hackclub] HACKCLUB_API_KEY not set — skipping.", "gemini");
    return null;
  }

  try {
    log(`[Hackclub] Trying model: ${HACKCLUB_MODEL}`, "gemini");
    const systemPrompt = await buildSharedSystemPrompt();

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
        max_tokens: 256,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      log(`[Hackclub] HTTP ${response.status}: ${errText}`, "gemini");
      return null;
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";

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
  const systemPrompt = await buildSharedSystemPrompt();
  const fullSystemPrompt =
    systemPrompt +
    "\n\nyou can now see images. if an image is attached, analyze it and include your thoughts on it in your typical sarcastic, rude personality. stay all lowercase.";

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
          const text = result.response.text().trim();

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

  // Fall back: text-only response noting the image couldn't be processed
  const fallbackMsg = userMessage
    ? `[image attached but can't be processed by fallback providers] ${userMessage}`
    : "[image attached but can't be processed by fallback providers — describe what you want to know about it]";
  return askGemini(fallbackMsg, authorName, channelId, context);
}

export async function askGemini(userMessage: string, authorName: string, channelId: string, context: AuthorContext = {}): Promise<string | null> {
  const prompt = buildUserPrompt(userMessage, authorName, context);
  const history = getHistory(channelId);
  const systemPrompt = await buildSharedSystemPrompt();

  if (geminiEnabled) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const client = getClient();

      for (const modelName of MODELS_TO_TRY) {
        try {
          log(`[Gemini] Trying model: ${modelName}`, "gemini");
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

          const chat = model.startChat({
            history: getGeminiHistory(history),
          });

          const result = await chat.sendMessage(prompt);
          const text = result.response.text().trim();

          if (text === "SKIP") {
            log(`[Gemini] Filtered message from ${authorName} — returning in-character refusal.`, "gemini");
            return getForbiddenResponse();
          }

          const tokens = result.response.usageMetadata?.totalTokenCount ?? 0;
          stats.totalTokens.gemini += tokens;
          stats.lastUsedProvider = "Gemini";
          stats.lastUsedModel = modelName;
          stats.totalRequests++;

          log(`[Gemini] Success with model ${modelName}`, "gemini");
          pushHistory(channelId, "user", prompt);
          pushHistory(channelId, "assistant", text);
          return text;
        } catch (err: any) {
          const msg: string = err.message ?? "";
          const isQuota = msg.includes("429") || msg.includes("quota");
          const isNotFound = msg.includes("404") || msg.includes("not found");
          const isRoleOrderError = msg.includes("First content should be with role 'user'");
          const isSafetyBlocked = isSafetyBlockedError(msg);

          if (isQuota || isNotFound) {
            log(`[Gemini] Model ${modelName} failed (${isQuota ? "quota" : "not found"}) — trying next.`, "gemini");
            continue;
          }

          if (isRoleOrderError) {
            log("[Gemini] History ordering invalid — clearing channel history and trying next model.", "gemini");
            clearHistory(channelId);
            continue;
          }

          if (isSafetyBlocked) {
            log("[Gemini] Safety blocked content — returning in-character refusal.", "gemini");
            return getForbiddenResponse();
          }

          log(`[Gemini] Error: ${msg} — trying next model.`, "gemini");
          continue;
        }
      }

      log("[Gemini] All models exhausted — falling back to Groq.", "gemini");
    } else {
      log("[Gemini] GEMINI_API_KEY not set — falling back to Groq.", "gemini");
    }
  } else {
    log("[Gemini] Disabled — falling back to Groq.", "gemini");
  }

  if (groqEnabled) {
    const reply = await tryGroq(prompt, history);
    if (reply) {
      pushHistory(channelId, "user", prompt);
      pushHistory(channelId, "assistant", reply);
      return reply;
    }
    log("[Groq] Failed or unavailable — falling back to Hackclub.", "gemini");
  } else {
    log("[Groq] Disabled — falling back to Hackclub.", "gemini");
  }

  if (!hackclubEnabled) {
    log("[Hackclub] Disabled — no response.", "gemini");
    return null;
  }

  const hackReply = await tryHackclub(prompt, history);
  if (hackReply) {
    pushHistory(channelId, "user", prompt);
    pushHistory(channelId, "assistant", hackReply);
  }
  return hackReply;
}

const QOTD_OPEN_PROMPT = `Generate a single Question of the Day for a Discord server. Requirements:
- Open-ended (NOT yes/no, NOT two-choice)
- Funny, chaotic, controversial, absurd, or genuinely thought-provoking
- Could be a hypothetical, unpopular opinion prompt, weird scenario, or philosophical chaos
- Should spark discussion and multiple different answers
- Keep it to 1-2 sentences max
Reply with ONLY the question itself. No quotation marks, no intro text, no explanation.`;

const QOTD_POLL_PROMPT = `Generate a "would you rather" or "this or that" question for a Discord poll. Requirements:
- Exactly TWO choices only
- Funny, chaotic, controversial, absurd, or mildly spicy
- Both options should feel like genuine dilemmas — no obvious right answer
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
        const text = result.response.text().trim();
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
    try {
      const client = getGroqClient();
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 1.1,
      });
      const text = completion.choices[0]?.message?.content?.trim() ?? "";
      if (text) {
        log(`[QOTD] Generated ${type} via Groq`, "qotd");
        return text;
      }
    } catch (err: any) {
      log(`[QOTD] Groq error: ${err.message}`, "qotd");
    }
  }

  log(`[QOTD] All providers failed for type: ${type}`, "qotd");
  return null;
}
