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
  if (!genAI) return null;

  const interestsList = Array.isArray(interests)
    ? interests
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

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

  const candidates = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  for (const modelId of candidates) {
    try {
      const model = getGenerativeModelForModelId(genAI, modelId, {
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 200,
          responseMimeType: 'application/json'
        }
      });
      if (!model) continue;

      const result = await model.generateContent(prompt);
      const parsed = safeJson(result?.response?.text?.() || '');
      if (parsed?.description && typeof parsed.description === 'string') {
        const desc = parsed.description.trim().slice(0, 160);
        if (desc.length > 10) return desc;
      }
    } catch (err) {
      console.error(`[BuddyGroupAI] Error with model ${modelId}:`, err.message);
      // Try next model
    }
  }

  return null;
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
  if (!genAI) return [];

  const candidates = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);

  for (let i = 0; i < Math.min(count, prompts.length); i++) {
    const { prompt: promptText, temperature } = prompts[i];
    
    for (const modelId of candidates) {
      try {
        const model = getGenerativeModelForModelId(genAI, modelId, {
          generationConfig: {
            temperature,
            maxOutputTokens: 200,
            responseMimeType: 'application/json'
          }
        });
        if (!model) continue;

        const result = await model.generateContent(promptText);
        const parsed = safeJson(result?.response?.text?.() || '');
        if (parsed?.description && typeof parsed.description === 'string') {
          const desc = parsed.description.trim().slice(0, 160);
          if (desc.length > 10) {
            descriptions.push(desc);
            break;
          }
        }
      } catch (err) {
        console.error(`[BuddyGroupAI] Multi-gen error with model ${modelId}:`, err.message);
      }
    }
  }

  return descriptions;
}
