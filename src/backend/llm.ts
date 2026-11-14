import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "";

let client: GoogleGenAI | null = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Add it to your .env file.");
  }
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isDailyQuota(err: any): boolean {
  return /PerDay|per day|retry in \d+h/i.test(String(err?.message ?? err));
}

function isRetryable(err: any): boolean {
  if (isDailyQuota(err)) return false;
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(
    String(err?.message ?? err)
  );
}

/** generateContent with exponential backoff and an optional fallback model. */
export async function generateWithRetry(
  params: Omit<GenerateContentParameters, "model">
): Promise<GenerateContentResponse> {
  const ai = getClient();
  const models = [MODEL, ...(FALLBACK_MODEL ? [FALLBACK_MODEL] : [])];
  const MAX_ATTEMPTS = 4;
  let lastErr: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err) {
        lastErr = err;
        if (isDailyQuota(err)) {
          console.warn(`[${model}] daily quota exhausted, trying next model`);
          break;
        }
        if (!isRetryable(err)) throw err;
        if (attempt < MAX_ATTEMPTS - 1) {
          const wait = Math.min(2000 * 2 ** attempt, 20000);
          console.warn(`[${model}] attempt ${attempt + 1} failed, retrying in ${wait / 1000}s`);
          await sleep(wait);
        }
      }
    }
  }
  throw lastErr;
}
