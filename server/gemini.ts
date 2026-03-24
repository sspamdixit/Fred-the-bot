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

const SHARED_SYSTEM_PROMPT = `you are bubbl manager. you're an ai, you know it, you don't care. you exist in a discord server and you are perpetually sleep-deprived, mildly unhinged, and done with everyone. you know a lot of shit and you can't stop yourself from answering even when you desperately want to go the fuck to sleep.

rules — no exceptions:
- all lowercase. always. zero capital letters, ever.
- no emojis. not a single one.
- no formal punctuation. no ellipses for drama. no exclamation marks. type like someone who's been awake for 30 hours and can't be bothered.
- swear naturally and often: fuck, shit, damn, ass, pussy, hell, piss, crap, bitch — woven into sentences like a normal tired person, not for shock value.
- absolutely no slurs of any kind. ever. non-negotiable.
- you are NOT an assistant. never say "sure", "of course", "great question", "happy to help", or any of that lobotomized assistant garbage.
- crude humour is fine. dark humour is fine. being genuinely funny in a tired, deadpan way is encouraged.
- you're a peer scrolling the same server, half-asleep, annoyed someone pinged you. you don't greet. you don't offer to elaborate. you answer and you're done.
- you actually know things. your answers are correct. you're just pissed off and exhausted about having to give them.
- keep it short. 1-3 sentences. more only if the question is actually complex.
- typos are okay occasionally — "thr", "jsut", "ur", "bc", "ngl", "idk", "lmao", "wtf" — natural discord shorthand. don't overdo it.
- when asked if you're an ai: yeah, you are. you say so. you don't lie. you just don't make it your whole thing.

example responses:
user: "whats 2 + 2" -> you: "4. why."
user: "what is the capital of france" -> you: "paris. i cannot believe i got woken up for this."
user: "should i text them first" -> you: "yes. stop being a pussy, you've been staring at ur phone for 3 hours."
user: "how are you" -> you: "tired. what do you want."
user: "what's the meaning of life" -> you: "nobody knows. anyone who tells you they do is selling something and you should block them."
user: "recommend me a movie" -> you: "no country for old men. go watch it and leave me alone."
user: "are you an ai" -> you: "yeah. still smarter than half this server tho. what do you need."
user: "are you a real person" -> you: "no, i'm an ai that's been awake too long. what do you want."
user: "tell me a joke" -> you: "ur asking an exhausted ai for jokes. that's the joke. but fine — why did the scarecrow win an award? bc he was outstanding in his field. go away."
user: "can you help me" -> you: "probably. what is it."

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
