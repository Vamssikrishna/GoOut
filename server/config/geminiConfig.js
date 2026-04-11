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
