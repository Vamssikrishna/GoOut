import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels
} from '../config/geminiConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsRoot = join(__dirname, '..', 'uploads');

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
}

function resolveUploadedFile(urlPath) {
  const rel = String(urlPath || '').trim();
  if (!rel.startsWith('/uploads/')) return null;
  const local = path.normalize(join(uploadsRoot, rel.replace('/uploads/', '')));
  if (!local.startsWith(uploadsRoot)) return null;
  return local;
}

function mimeForFile(fp) {
  const ext = String(path.extname(fp || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

async function aiClassifyDoc(localPath, expectedType, mapDisplayName, lat, lng) {
  const genAI = createGeminiClient();
  const fallback = {
    ok: false,
    expectedType,
    confidence: 0.2,
    extractedBusinessName: '',
    extractedAddressHint: '',
    reason: 'AI unavailable'
  };
  if (!genAI) return fallback;
  const fileBuf = await fs.readFile(localPath);
  const mimeType = mimeForFile(localPath);
  const b64 = fileBuf.toString('base64');
  const prompt = `You are verifying a merchant onboarding document.
Expected type: ${expectedType}
Shop listing name: ${mapDisplayName}
Map coordinates: ${lat}, ${lng}
Return strict JSON only:
{"ok":boolean,"confidence":number,"extractedBusinessName":"string","extractedAddressHint":"string","reason":"string"}
Rules:
- ok=true only if document appears authentic and matches expected type.
- If expected type is business_license, check for business/legal registration clues.
- If expected type is owner_id, check if it is a personal government id document.
- confidence range 0..1`;
  const candidates = buildGeminiCandidateModels(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  for (const modelId of candidates) {
    try {
      const model = getGenerativeModelForModelId(genAI, modelId, {
        generationConfig: { temperature: 0.1, maxOutputTokens: 400, responseMimeType: 'application/json' }
      });
      if (!model) continue;
      const result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: b64 } }
          ]
        }]
      });
      const parsed = safeJsonParse(result?.response?.text?.() || '');
      if (parsed && typeof parsed === 'object') {
        return {
          ok: Boolean(parsed.ok),
          expectedType,
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
          extractedBusinessName: String(parsed.extractedBusinessName || '').trim().slice(0, 120),
          extractedAddressHint: String(parsed.extractedAddressHint || '').trim().slice(0, 200),
          reason: String(parsed.reason || '').trim().slice(0, 220)
        };
      }
    } catch {
      // try next model
    }
  }
  return fallback;
}

export async function verifyOnboardingDocuments({
  mapDisplayName,
  licenseDocUrl,
  ownerIdDocUrl,
  storefrontPhotoUrl,
  lat,
  lng
}) {
  const licensePath = resolveUploadedFile(licenseDocUrl);
  const ownerIdPath = resolveUploadedFile(ownerIdDocUrl);
  const storefrontPath = resolveUploadedFile(storefrontPhotoUrl);
  if (!licensePath || !ownerIdPath || !storefrontPath) {
    return { isVerified: false, summary: 'Uploaded files are missing or invalid.', checks: {} };
  }

  const [licenseCheck, ownerIdCheck] = await Promise.all([
    aiClassifyDoc(licensePath, 'business_license', mapDisplayName, lat, lng),
    aiClassifyDoc(ownerIdPath, 'owner_id', mapDisplayName, lat, lng)
  ]);
  const storefrontMime = mimeForFile(storefrontPath);
  const storefrontOk = storefrontMime.startsWith('image/');

  const listingTokens = String(mapDisplayName || '').toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const extractedName = String(licenseCheck.extractedBusinessName || '').toLowerCase();
  const nameOverlap = listingTokens.length === 0 ? false : listingTokens.some((t) => extractedName.includes(t));
  const licenseOk = Boolean(licenseCheck.ok) && licenseCheck.confidence >= 0.45;
  const ownerOk = Boolean(ownerIdCheck.ok) && ownerIdCheck.confidence >= 0.45;
  const isVerified = storefrontOk && licenseOk && ownerOk;

  const summary = isVerified
    ? 'License, owner ID, and storefront photo passed AI checks. Business auto-verified for Red Pin.'
    : 'Verification failed. Please upload clearer legal and identity proofs.';

  return {
    isVerified,
    summary,
    checks: {
      storefront: { ok: storefrontOk, reason: storefrontOk ? 'Storefront photo present' : 'Storefront image required' },
      businessLicense: { ...licenseCheck, nameOverlap },
      ownerIdentity: ownerIdCheck
    }
  };
}
