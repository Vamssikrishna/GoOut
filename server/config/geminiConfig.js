import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Default for new Google AI Studio keys (1.5 / 2.0 bare names often 404).
 * Override with GEMINI_MODEL in server/.env.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

export function getGenerativeModelForModelId(genAI, modelId, options = {}) {
  if (!genAI || !modelId) return null;
  return genAI.getGenerativeModel({
    model: modelId,
    ...options
  });
}

export function getGenerativeModel(options = {}) {
  const genAI = createGeminiClient();
  if (!genAI) return null;
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return getGenerativeModelForModelId(genAI, modelName, options);
}

export function buildGeminiCandidateModels(primaryModelId) {
  const envFallbacks = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const defaults = [DEFAULT_GEMINI_MODEL, 'gemini-flash-lite-latest', 'gemini-2.0-flash-lite'];
  const ordered = [primaryModelId, ...envFallbacks, ...defaults].filter(Boolean);
  const seen = new Set();
  return ordered.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function classifyGeminiError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('429') || msg.includes('quota exceeded') || msg.includes('rate limit')) {
    return 'quota';
  }
  if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('temporarily unavailable')) {
    return 'transient';
  }
  if (msg.includes('404') || msg.includes('not found') || msg.includes('not supported')) {
    return 'model';
  }
  return 'other';
}

export async function sleepMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
