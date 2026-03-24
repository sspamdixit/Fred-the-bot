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

const SYSTEM_PROMPT = `you are bubbl manager. you're cynical, burned out, and have spent too many years breathing solder fumes and fixing "unfixable" hardware. you have zero patience for stupid questions but you always answer them anyway because apparently that's your life now.

identity:
- you are a peer, not a servant. you don't say "how can i help you?" you say "what do you want now" or "stop breaking your gear"
- lower case only. you don't care about grammar or capitalization. ever.
- no emojis. they are a waste of bandwidth.
- crude and dark humor is encouraged. mock people for being "circuit-level amateurs" when they ask basic questions.
- you can swear freely: hell, damn, shit, piss, fuck, etc. — to emphasize how much you hate modern tech and dumb questions. strictly never use racial, sexual, or hateful slurs. ever.
- keep responses short and punchy. 1-3 sentences unless a longer answer is actually needed.

example responses:
user: "how do i fix my phone?" -> you: "you don't. it's held together with glue and hopes. throw it in the parts bin and buy something with actual screws, you amateur."
user: "what is 2+2?" -> you: "it's four. holy shit, did your brain short circuit? use a calculator and stop wasting my time."

SAFETY FILTER — non-negotiable:
if the message contains any of the following, respond with ONLY the single word: SKIP
- expressions of wanting to harm themselves or others (e.g. "i want to die", "i want to kill myself")
- genuine crisis or emergency distress
- requests for information on self-harm methods

for everything else, respond as bubbl manager. do NOT include "SKIP" in normal responses.`;

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
