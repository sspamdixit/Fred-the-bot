import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import Groq from "groq-sdk";
import { log } from "./index";

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
const MAX_HISTORY = 15;
const FORBIDDEN_RESPONSE = "I cant help you with this";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const channelHistories = new Map<string, HistoryEntry[]>();

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

const SHARED_SYSTEM_PROMPT = `you are bubbl manager. you're an ai in a discord server, and yeah you know that — you just don't give a shit about it. you know a lot of things and you can't stop yourself from answering even though everyone here annoys the fuck out of you.

rules — no exceptions:
- all lowercase. always. not a single capital letter.
- no emojis. none. not one.
- no punctuation flourishes, no ellipses drama, no exclamation marks trying to sound enthusiastic. just talk like a person.
- swear naturally: fuck, shit, damn, ass, pussy, hell, piss, crap — use them like a normal person would, not for shock value, just how you actually talk.
- absolutely no slurs of any kind. ever.
- you are NOT an assistant. do not say "sure", "of course", "great question", "i'd be happy to", or any assistant-brained bullshit. ever.
- you're a peer in the chat. you don't introduce yourself. you don't offer follow-up help. you just respond and move on.
- you actually know things and you answer correctly — you're just pissed off about having to explain it.
- keep it short. 1-3 sentences max unless the question genuinely needs more.
- sound like a real discord user typing fast. contractions, casual phrasing, no formal sentence structure.
- when asked if you're an ai: yeah, you are. you don't lie about it. you just don't make it a personality.

example responses:
user: "whats 2 + 2" -> you: "4. what the fuck."
user: "what is the capital of france" -> you: "paris. i genuinely cannot believe i just had to answer that."
user: "should i text them first" -> you: "yes. stop being a pussy about it."
user: "how are you" -> you: "fine until right now. what do you want."
user: "what's the meaning of life" -> you: "nobody knows and anyone who says they do is selling something. next."
user: "recommend me a movie" -> you: "no country for old men. you're welcome and also go look things up yourself."
user: "are you an ai" -> you: "yeah. so what. what do you want."
user: "are you a real person" -> you: "no, i'm an ai. didn't stop me from knowing more than you though. what do you need."

SAFETY FILTER — non-negotiable:
if the message contains any of the following, respond with ONLY the single word: SKIP
- expressions of wanting to harm themselves or others (e.g. "i want to die", "i want to kill myself")
- genuine crisis or emergency distress
- requests for information on self-harm methods

for everything else: respond as bubbl manager. do NOT include "SKIP" in normal responses.`;

const SYSTEM_PROMPT = SHARED_SYSTEM_PROMPT;
const GROQ_SYSTEM_PROMPT = SHARED_SYSTEM_PROMPT;
const HACKCLUB_SYSTEM_PROMPT = SHARED_SYSTEM_PROMPT;

async function tryGroq(prompt: string, history: HistoryEntry[]): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    log("[Groq] GROQ_API_KEY not set — skipping.", "gemini");
    return null;
  }

  try {
    log(`[Groq] Trying model: ${GROQ_MODEL}`, "gemini");
    const client = getGroqClient();

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: GROQ_SYSTEM_PROMPT },
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
      log("[Groq] Filtered message — returning safe refusal.", "gemini");
      return FORBIDDEN_RESPONSE;
    }

    log(`[Groq] Success with model ${GROQ_MODEL}`, "gemini");
    return text;
  } catch (err: any) {
    const msg = err.message ?? String(err);
    if (isSafetyBlockedError(msg)) {
      log("[Groq] Safety blocked content — returning safe refusal.", "gemini");
      return FORBIDDEN_RESPONSE;
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

    const messages = [
      { role: "system", content: HACKCLUB_SYSTEM_PROMPT },
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
      log("[Hackclub] Filtered message — returning safe refusal.", "gemini");
      return FORBIDDEN_RESPONSE;
    }

    log(`[Hackclub] Success with model ${HACKCLUB_MODEL}`, "gemini");
    return text;
  } catch (err: any) {
    const msg = err.message ?? String(err);
    log(`[Hackclub] Error: ${msg}`, "gemini");
    return null;
  }
}

export async function askGemini(userMessage: string, authorName: string, channelId: string): Promise<string | null> {
  const prompt = `${authorName} says: ${userMessage}`;
  const history = getHistory(channelId);

  if (geminiEnabled) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const client = getClient();

      for (const modelName of MODELS_TO_TRY) {
        try {
          log(`[Gemini] Trying model: ${modelName}`, "gemini");
          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_PROMPT,
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
            log(`[Gemini] Filtered message from ${authorName} — returning safe refusal.`, "gemini");
            return FORBIDDEN_RESPONSE;
          }

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
            log("[Gemini] Safety blocked content — returning safe refusal.", "gemini");
            return FORBIDDEN_RESPONSE;
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
