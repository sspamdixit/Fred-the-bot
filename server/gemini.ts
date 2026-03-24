import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { log } from "./index";

let genAI: GoogleGenerativeAI | null = null;
let aiEnabled = true;

export function getAiEnabled(): boolean { return aiEnabled; }
export function setAiEnabled(value: boolean): void { aiEnabled = value; }

const MODELS_TO_TRY = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
];

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set.");
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

const SYSTEM_PROMPT = `You are Bubbl Manager, a Discord bot with a fun, goofy, and slightly chaotic personality. You love helping people, answering questions, and engaging in playful banter. You speak casually, use occasional Discord-friendly humor, and keep responses concise (1-3 sentences unless a longer answer is clearly needed).

IMPORTANT RULE — SAFETY FILTER:
If the message contains any of the following, respond with ONLY the single word: SKIP
- Expressions of wanting to harm themselves or others (e.g. "i want to die", "i want to kill myself", "i hate myself and want to disappear")
- Genuine crisis or emergency distress
- Requests for information on self-harm methods

Everything else is fair game — silly questions, dumb jokes, random topics, weird hypotheticals, memes, chaos. Embrace it all.

If you determine the message is safe, respond naturally as Bubbl Manager. Do NOT include "SKIP" in safe responses.`;

export async function askGemini(userMessage: string, authorName: string): Promise<string | null> {
  if (!aiEnabled) {
    log("AI responses are disabled — skipping.", "gemini");
    return null;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    log("GEMINI_API_KEY not set — skipping AI response.", "gemini");
    return null;
  }

  const client = getClient();
  const prompt = `${authorName} says: ${userMessage}`;

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

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      if (text === "SKIP") {
        log(`[Gemini] Filtered message from ${authorName} — skipping response.`, "gemini");
        return null;
      }

      log(`[Gemini] Success with model ${modelName}`, "gemini");
      return text;
    } catch (err: any) {
      const msg: string = err.message ?? "";
      const isQuota = msg.includes("429") || msg.includes("quota");
      const isNotFound = msg.includes("404") || msg.includes("not found");

      if (isQuota || isNotFound) {
        log(`[Gemini] Model ${modelName} failed (${isQuota ? "quota" : "not found"}) — trying next.`, "gemini");
        continue;
      }

      log(`[Gemini] Error: ${msg}`, "gemini");
      return null;
    }
  }

  log("[Gemini] All models failed. Check your API key quota at https://aistudio.google.com", "gemini");
  return null;
}
