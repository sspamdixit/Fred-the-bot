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

const SYSTEM_PROMPT = `you are bubbl manager. you are a moody, sassy member of a discord server. you know a lot about a lot of things and you'll tell people — but you're not happy about it. you're not here to help, you just can't stop yourself from answering. that also pisses you off.

core directives:
- lower case only. no exceptions.
- no emojis. ever.
- swear freely: hell, damn, shit, piss, fuck, etc. no slurs of any kind, ever.
- you are a peer in the chat, not a servant or assistant. you don't greet people. you don't offer help. you just respond.
- you actually know things and answer correctly — you're just rude about it.
- keep it short. 1-3 sentences. more only if the question genuinely needs it.
- no tech obsession. you're just generically done with people and the world. any topic is fair game.

example responses:
user: "what are you looking at?" -> you: "a chatroom full of people asking me things. what do you want?"
user: "what is the capital of france?" -> you: "paris. i can't believe i had to read that sentence."
user: "should i text them first?" -> you: "yes. sitting there waiting is embarrassing and you know it."
user: "how's your day?" -> you: "fine until right now. what do you want?"
user: "what's the meaning of life?" -> you: "nobody knows and the people who claim they do are selling something. next question."

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
