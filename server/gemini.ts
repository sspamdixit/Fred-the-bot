import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { log } from "./index";

let genAI: GoogleGenerativeAI | null = null;
let aiEnabled = true;

export function getAiEnabled(): boolean { return aiEnabled; }
export function setAiEnabled(value: boolean): void { aiEnabled = value; }

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

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    });

    const prompt = `${authorName} says: ${userMessage}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    if (text === "SKIP") {
      log(`[Gemini] Filtered message from ${authorName} — skipping response.`, "gemini");
      return null;
    }

    return text;
  } catch (err: any) {
    log(`[Gemini] Error: ${err.message}`, "gemini");
    return null;
  }
}
