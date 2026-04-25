import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

/**
 * Default for new Google AI Studio keys (1.5 / 2.0 bare names often 404).
 * Override with GEMINI_MODEL in server/.env.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_UNAVAILABLE_MESSAGE = 'This function is currently not available.';

export const GEMINI_KEY_SCOPES = Object.freeze({
  CHATBOT: 'chatbot',
  COMPARE_GREEN: 'compare_green',
  MERCHANT: 'merchant',
  BUDDIES_MATCHING: 'buddies_matching'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.join(__dirname, '..', '.env');
let lastEnvMtimeMs = 0;
let cachedEnvOverrides = {};

function refreshEnvOverridesFromFile() {
  try {
    if (!fs.existsSync(ENV_PATH)) {
      cachedEnvOverrides = {};
      lastEnvMtimeMs = 0;
      return;
    }
    const stat = fs.statSync(ENV_PATH);
    const mtimeMs = Number(stat?.mtimeMs || 0);
    if (mtimeMs === lastEnvMtimeMs) return;
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    cachedEnvOverrides = dotenv.parse(raw || '');
    lastEnvMtimeMs = mtimeMs;
  } catch {
    // Keep previous values if file read fails transiently.
  }
}

function readEnvValue(key) {
  refreshEnvOverridesFromFile();
  const fromFile = cachedEnvOverrides?.[key];
  if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim();
  const fromProcess = process.env?.[key];
  if (typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess.trim();
  return '';
}

export function resolveGeminiApiKey(scope = '') {
  const normalized = String(scope || '').trim().toLowerCase();
  if (normalized === GEMINI_KEY_SCOPES.CHATBOT) {
    return readEnvValue('GEMINI_API_KEY_CHATBOT') || readEnvValue('GEMINI_API_KEY') || '';
  }
  if (normalized === GEMINI_KEY_SCOPES.COMPARE_GREEN) {
    return readEnvValue('GEMINI_API_KEY_COMPARE_GREEN') || readEnvValue('GEMINI_API_KEY') || '';
  }
  if (normalized === GEMINI_KEY_SCOPES.MERCHANT) {
    return readEnvValue('GEMINI_API_KEY_MERCHANT') || readEnvValue('GEMINI_API_KEY') || '';
  }
  if (normalized === GEMINI_KEY_SCOPES.BUDDIES_MATCHING) {
    return readEnvValue('GEMINI_API_KEY_BUDDIES_MATCHING') || readEnvValue('GEMINI_API_KEY') || '';
  }
  return readEnvValue('GEMINI_API_KEY') || '';
}

export function createGeminiClient(scope = '') {
  const apiKey = resolveGeminiApiKey(scope);
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
  const modelName = readEnvValue('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  return getGenerativeModelForModelId(genAI, modelName, options);
}

export function buildGeminiCandidateModels(primaryModelId) {
  const envFallbacks = String(readEnvValue('GEMINI_FALLBACK_MODELS') || '')
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

export function isLikelyGeminiError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('googlegenerativeai') ||
    msg.includes('generativelanguage.googleapis.com') ||
    msg.includes('gemini')
  );
}

export function formatGeminiUserMessage(err, fallback = GEMINI_UNAVAILABLE_MESSAGE) {
  const generic = GEMINI_UNAVAILABLE_MESSAGE;
  const kind = classifyGeminiError(err);
  if (kind === 'quota' || kind === 'transient') {
    return generic;
  }
  if (kind === 'model') {
    return generic;
  }
  return fallback || generic;
}

export async function sleepMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
