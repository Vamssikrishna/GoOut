import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels,
  GEMINI_KEY_SCOPES
} from '../config/geminiConfig.js';

function safeJson(raw) {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout:${ms}`)), ms);
    })
  ]);
}

function normalizeInterests(interests = []) {
  return Array.isArray(interests)
    ? interests
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
}

function compactText(value, max = 160) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildFastDescription(activity, interests = [], meetingPlace = '', variant = 0) {
  const act = compactText(activity, 80);
  const place = compactText(meetingPlace, 50);
  const tags = normalizeInterests(interests);
  const tone = [
    'Easy vibe, good people, and a clear plan.',
    'Friendly pace, open to all levels, and zero pressure.',
    'Come as you are and explore together.',
    'Low-pressure meetup with room to connect.',
    'Simple plan, social energy, and good local vibes.'
  ][variant % 5];
  const interestBit = tags.length ? ` Focus: ${tags.slice(0, 2).join(' + ')}.` : '';
  const placeBit = place ? ` Meet at ${place}.` : '';
  return compactText(`${act}${placeBit} ${tone}${interestBit}`, 160);
}

/**
 * Generate a unique, engaging description for a buddy group based on the activity.
 * Uses Gemini AI to create personalized group descriptions.
 * @param {string} activity - The main activity for the group (e.g., "hiking", "coffee chat")
 * @param {Array<string>} interests - Optional interests/tags for the group
 * @param {string} meetingPlace - Optional meeting location
 * @returns {Promise<string|null>} - AI-generated description, or null if generation fails
 */
export async function generateGroupDescription(activity, interests = [], meetingPlace = '') {
  const activityStr = String(activity || '').trim().slice(0, 120);
  if (!activityStr) return null;

  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.BUDDIES_MATCHING);
  if (!genAI) return buildFastDescription(activityStr, interests, meetingPlace);

  const interestsList = normalizeInterests(interests);

  const placeContext = meetingPlace ? ` at ${meetingPlace}` : '';
  const interestContext = interestsList.length ? ` (interests: ${interestsList.join(', ')})` : '';

  const prompt = `Create a short, engaging, and unique description for a buddy group meetup.
Activity: "${activityStr}"${interestContext}${placeContext}

Generate a 1-2 sentence description that:
- Is inviting and friendly
- Captures the vibe of the activity
- Makes explorers want to join
- No hashtags, no emojis, plain text only
- Max 160 characters

Return strict JSON only:
{"description":"text here"}`;

  // Speed-first path: try one model with tight timeout; fallback immediately.
  const modelId = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL)[0];
  try {
    const model = getGenerativeModelForModelId(genAI, modelId, {
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 140,
        responseMimeType: 'application/json'
      }
    });
    if (!model) return buildFastDescription(activityStr, interestsList, meetingPlace);
    const result = await withTimeout(model.generateContent(prompt), 1800);
    const parsed = safeJson(result?.response?.text?.() || '');
    if (parsed?.description && typeof parsed.description === 'string') {
      const desc = compactText(parsed.description, 160);
      if (desc.length > 10) return desc;
    }
  } catch (err) {
    console.error(`[BuddyGroupAI] Error with model ${modelId}:`, err.message);
  }
  return buildFastDescription(activityStr, interestsList, meetingPlace);
}

/**
 * Generate multiple description options for a buddy group (for UI preview).
 * @param {string} activity - The main activity for the group
 * @param {Array<string>} interests - Optional interests/tags
 * @param {string} meetingPlace - Optional meeting location
 * @returns {Promise<Array<string>>} - Array of generated descriptions
 */
export async function generateMultipleDescriptions(activity, interests = [], meetingPlace = '', count = 3) {
  const descriptions = [];
  const safeCount = Math.max(1, Math.min(Number(count) || 3, 5));
  const activityStr = compactText(activity, 120);
  const interestList = normalizeInterests(interests);
  if (!activityStr) return [];
  
  // Generate descriptions with different prompts
  const prompts = [
    {
      prompt: `Create a short, engaging description for a buddy group meetup.
Activity: "${activity}"
Style: Casual and fun, emphasizing the vibe and social aspect.
Max 160 chars.
Return JSON: {"description":"text"}`,
      temperature: 0.8
    },
    {
      prompt: `Generate a catchy group description for a buddy meetup.
Activity: "${activity}"
Style: Adventurous and inclusive, welcoming all skill levels.
Max 160 chars.
Return JSON: {"description":"text"}`,
      temperature: 0.9
    },
    {
      prompt: `Write a friendly group description for a buddy activity.
Activity: "${activity}"
Style: Warm and community-focused, emphasizing connection.
Max 160 chars.
Return JSON: {"description":"text"}`,
      temperature: 0.7
    }
  ];

  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.BUDDIES_MATCHING);
  if (!genAI) {
    for (let i = 0; i < safeCount; i++) {
      descriptions.push(buildFastDescription(activityStr, interestList, meetingPlace, i));
    }
    return descriptions;
  }

  // Fast mode for preview: only first candidate model + short timeout.
  const modelId = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL)[0];
  for (let i = 0; i < Math.min(safeCount, prompts.length); i++) {
    const { prompt: promptText, temperature } = prompts[i];
    try {
      const model = getGenerativeModelForModelId(genAI, modelId, {
        generationConfig: {
          temperature,
          maxOutputTokens: 140,
          responseMimeType: 'application/json'
        }
      });
      if (!model) throw new Error('missing-model');
      const result = await withTimeout(model.generateContent(promptText), 1800);
      const parsed = safeJson(result?.response?.text?.() || '');
      if (parsed?.description && typeof parsed.description === 'string') {
        const desc = compactText(parsed.description, 160);
        if (desc.length > 10) {
          descriptions.push(desc);
          continue;
        }
      }
    } catch (err) {
      console.error(`[BuddyGroupAI] Multi-gen error with model ${modelId}:`, err.message);
    }
    descriptions.push(buildFastDescription(activityStr, interestList, meetingPlace, i));
  }

  return [...new Set(descriptions)].slice(0, safeCount);
}
