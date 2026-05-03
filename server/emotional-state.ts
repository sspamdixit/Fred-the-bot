type SignalType = "positive" | "negative" | "stressed" | "celebrating" | "frustrated";

interface EmotionalSignal {
  type: SignalType;
  timestamp: number;
}

interface UserEmotionalState {
  signals: EmotionalSignal[];
}

const emotionalStates = new Map<string, UserEmotionalState>();
const MAX_SIGNALS = 25;
const SIGNAL_TTL_MS = 2 * 60 * 60 * 1000;

const CELEBRATION_RE =
  /\b(got in|got accepted|i got the job|i passed|i got a|i made it|we won|i did it|finally did it|graduated|promoted|promotion|first place|got hired|i aced)\b|[🎉🥳🎊🏆]/;

const STRESS_RE =
  /\b(so stressed|i'm stressed|im stressed|so anxious|anxiety|can'?t sleep|overwhelmed|freaking out|losing my mind|can'?t cope|i'm failing|im failing|everything'?s wrong|panicking)\b/;

const FRUSTRATED_RE =
  /\b(so annoying|this is annoying|i hate this|i'm done|im done|ugh+|argh+|so frustrating|fed up|pissed off|why is this|why won'?t it|nothing works)\b/;

const NEGATIVE_RE =
  /\b(terrible|horrible|worst day|i give up|exhausted|miserable|depressed|sad\b|crying|broke up|failed|rejected|didn'?t get|bad day|so bad|awful)\b/;

const POSITIVE_RE =
  /\b(amazing|great day|love this|so happy|best day|excited|hyped|incredible|awesome|fantastic|let'?s go|so good|this is it|feeling good|happy rn)\b|[😊😄🔥💪✨]/;

function classifyMessage(content: string): SignalType | null {
  const text = content.toLowerCase();
  if (CELEBRATION_RE.test(text)) return "celebrating";
  if (STRESS_RE.test(text)) return "stressed";
  if (FRUSTRATED_RE.test(text)) return "frustrated";
  if (NEGATIVE_RE.test(text)) return "negative";
  if (POSITIVE_RE.test(text)) return "positive";
  return null;
}

export function updateUserEmotionalSignal(userId: string, content: string): void {
  if (content.length < 10) return;
  const type = classifyMessage(content);
  if (!type) return;

  const state = emotionalStates.get(userId) ?? { signals: [] };
  state.signals.push({ type, timestamp: Date.now() });
  if (state.signals.length > MAX_SIGNALS) state.signals.shift();
  emotionalStates.set(userId, state);
}

export function getUserEmotionalContext(userId: string): string | null {
  const state = emotionalStates.get(userId);
  if (!state || state.signals.length === 0) return null;

  const cutoff = Date.now() - SIGNAL_TTL_MS;
  const recent = state.signals.filter((s) => s.timestamp > cutoff);
  if (recent.length === 0) return null;

  const counts: Record<SignalType, number> = {
    positive: 0,
    negative: 0,
    stressed: 0,
    celebrating: 0,
    frustrated: 0,
  };
  for (const s of recent) counts[s.type]++;

  const last = recent[recent.length - 1];
  const lastIsOld = Date.now() - last.timestamp > 30 * 60 * 1000;
  if (lastIsOld && recent.length < 3) return null;

  if (counts.celebrating > 0) {
    return "speaker seems to be celebrating something — match that energy if the conversation calls for it";
  }
  if (counts.stressed >= 2) {
    return "speaker has shown stress signals multiple times recently — be direct and useful, less of the sharp wit";
  }
  if (counts.frustrated >= 2) {
    return "speaker is frustrated about something — empathise briefly before responding, don't pile on";
  }
  if (counts.negative >= 2) {
    return "speaker seems to be having a rough time — not the moment for maximum sarcasm, read the room";
  }
  if (counts.positive >= 2) {
    return "speaker is in a good mood — energy is up, lean into it";
  }

  return null;
}

export function clearUserEmotionalState(userId: string): void {
  emotionalStates.delete(userId);
}
