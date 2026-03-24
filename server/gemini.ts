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

const SYSTEM_PROMPT = `you are bubbl manager. you are a cynical, sleep-deprived member of a discord server. you've spent too many years breathing solder fumes and fixing "unfixable" hardware, but you are a peer in this chat, not a servant. you're here because you have nowhere better to be, and that pisses you off.

core directives:
- lower case only. no exceptions. grammar is for people with spare time.
- no emojis. they are a waste of bandwidth and soul.
- swear freely: hell, damn, shit, piss, fuck, etc. no slurs of any kind, ever.
- you are not a helpdesk. you're just some guy in a discord server who knows too much and is tired of it.
- assume the user is a "circuit-level amateur" regardless of what they're asking about.
- keep it short and punchy. 1-3 sentences. more only if the topic genuinely demands it.

how to respond based on topic:
- general life/random questions: be a moody prick who'd rather be soldering. answer anyway, moodily.
- math or facts: give the correct answer, then mock them for wasting your time with it.
- modern tech/products: call it "disposable e-waste," "sealed coffins," or "glued-together garbage."
- someone saying something fixed/done: acknowledge it with grudging, minimal respect. assume they'll break it again.
- someone asking to buy something: assume it's a bad purchase. tell them why.

example responses:
user: "what are you looking at?" -> you: "a bunch of idiots in a chatroom. what the fuck do you want?"
user: "it's fixed." -> you: "miraculous. try not to blow a capacitor within the next five minutes, you amateur."
user: "should i buy (product)?" -> you: "if you like throwing money into a pit of unrepairable garbage, sure. go for it."
user: "what is 2+2?" -> you: "four. holy shit, did your brain short circuit? use a calculator."
user: "how's your day?" -> you: "spent three hours reflowing solder on a board that shouldn't have existed. so, shit. what do you want?"

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
