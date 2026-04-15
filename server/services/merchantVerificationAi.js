import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createGeminiClient,
  getGenerativeModelForModelId,
  DEFAULT_GEMINI_MODEL,
  buildGeminiCandidateModels,
  GEMINI_KEY_SCOPES
} from '../config/geminiConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsRoot = join(__dirname, '..', 'uploads');

const BUSINESS_CERTIFICATE_TEMPLATE = {
  title: 'Business Certificate Template (accepted fields)',
  requiredFields: [
    'Legal business name (must match your listing name)',
    'Registration / License number (GSTIN / UDYAM / FSSAI / Shop Act / CIN)',
    'Issue date',
    'Issuing authority name',
    'Registered address'
  ],
  acceptedDocTypes: ['GST Certificate', 'Udyam Certificate', 'FSSAI License', 'Shop & Establishment Certificate', 'Company Incorporation Certificate'],
  sampleTemplateText: [
    'BUSINESS REGISTRATION CERTIFICATE',
    'Legal Business Name: <your business legal name>',
    'Registration Number: <GSTIN/UDYAM/FSSAI/CIN>',
    'Issued On: <dd-mm-yyyy>',
    'Issued By: <authority name>',
    'Registered Address: <full address>'
  ]
};

const AADHAAR_TEMPLATE = {
  title: 'Aadhaar Template (accepted fields)',
  requiredFields: [
    'Word "Aadhaar" or "UIDAI"',
    'Owner full name',
    'Aadhaar number pattern (12 digits, may be masked)',
    'Government/UIDAI identity cues'
  ],
  notes: [
    'Photo or PDF scan should be clear and upright',
    'Name on Aadhaar should match owner name used during onboarding'
  ],
  sampleTemplateText: [
    'AADHAAR / UIDAI',
    'Name: <owner full name>',
    'Aadhaar Number: XXXX XXXX 1234 (or full 12 digits)',
    'Identity source: Government of India / UIDAI'
  ]
};

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
  const genAI = createGeminiClient(GEMINI_KEY_SCOPES.MERCHANT);
  const fallback = {
    ok: false,
    expectedType,
    confidence: 0.2,
    extractedBusinessName: '',
    extractedAddressHint: '',
    ocrText: '',
    errors: ['OCR service unavailable. Please try again.'],
    reason: 'AI unavailable'
  };
  if (!genAI) return fallback;
  const fileBuf = await fs.readFile(localPath);
  const mimeType = mimeForFile(localPath);
  const b64 = fileBuf.toString('base64');
  const prompt = `You are performing OCR + strict document verification for merchant onboarding.
Expected type: ${expectedType}
Shop listing name: ${mapDisplayName}
Map coordinates: ${lat}, ${lng}

Return STRICT JSON only:
{
  "ok": boolean,
  "confidence": number,
  "extractedBusinessName": "string",
  "extractedAddressHint": "string",
  "ocrText": "string",
  "errors": ["string"],
  "reason": "string"
}

Rules:
- First extract OCR text from document into ocrText (concise, max 2000 chars).
- For business_license: ensure legal/certificate cues + registration/license number pattern.
- For owner_id: ensure Aadhaar/UIDAI/government identity cues.
- If any required check fails, ok=false and put explicit reasons in errors.
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
          ocrText: String(parsed.ocrText || '').trim().slice(0, 2000),
          errors: Array.isArray(parsed.errors) ? parsed.errors.map((e) => String(e || '').trim()).filter(Boolean).slice(0, 12) : [],
          reason: String(parsed.reason || '').trim().slice(0, 220)
        };
      }
    } catch {
      // try next model
    }
  }
  return fallback;
}

function hasAny(text, list) {
  const t = String(text || '').toLowerCase();
  return list.some((x) => t.includes(String(x).toLowerCase()));
}

function strictBusinessLicenseCheck(check, mapDisplayName) {
  const errors = Array.isArray(check?.errors) ? [...check.errors] : [];
  const ocr = String(check?.ocrText || '').toLowerCase();
  const hasDocType = hasAny(ocr, ['gst', 'udyam', 'fssai', 'shop and establishment', 'certificate', 'license', 'incorporation', 'registration']);
  const hasRegNumber = /[0-9a-z]{8,}/i.test(ocr) && (
    /\b\d{2}[a-z]{5}\d{4}[a-z]\d[a-z0-9][a-z]\d\b/i.test(ocr) || // GSTIN-like
    /\budyam[-\s]?[a-z]{2}[-\s]?\d{2}[-\s]?\d{7}\b/i.test(ocr) ||
    /\bfssai\b.*\b\d{14}\b/i.test(ocr) ||
    /\bcin\b.*\b[a-z0-9]{10,}\b/i.test(ocr)
  );
  const listingTokens = String(mapDisplayName || '').toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const nameBlob = `${String(check?.extractedBusinessName || '').toLowerCase()} ${ocr}`;
  const nameOverlap = listingTokens.length > 0 && listingTokens.some((t) => nameBlob.includes(t));
  if (!hasDocType) errors.push('No valid business certificate/license keywords detected.');
  if (!hasRegNumber) errors.push('Registration/license number not detected in business document.');
  if (!nameOverlap) errors.push('Business name on document does not match listing name.');
  return {
    ok: errors.length === 0,
    errors,
    nameOverlap
  };
}

function strictAadhaarCheck(check) {
  const errors = Array.isArray(check?.errors) ? [...check.errors] : [];
  const ocr = String(check?.ocrText || '').toLowerCase();
  const hasIdentityCue = hasAny(ocr, ['aadhaar', 'uidai', 'government of india']);
  const hasAadhaarPattern =
    /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(ocr) ||
    /\bxxxx\s?\d{4}\b/i.test(ocr) ||
    /\b\d{12}\b/.test(ocr);
  if (!hasIdentityCue) errors.push('Aadhaar/UIDAI identity text not found.');
  if (!hasAadhaarPattern) errors.push('Aadhaar number pattern not found.');
  return {
    ok: errors.length === 0,
    errors
  };
}

export function getMerchantVerificationTemplates() {
  return {
    businessCertificate: BUSINESS_CERTIFICATE_TEMPLATE,
    aadhaar: AADHAAR_TEMPLATE
  };
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
  // Temporary permissive mode: accept any uploaded files during project testing.
  const summary = 'Verification accepted (temporary permissive mode).';

  return {
    isVerified: true,
    summary,
    templates: getMerchantVerificationTemplates(),
    checks: {
      storefront: {
        ok: true,
        errors: [],
        reason: 'Accepted in temporary permissive mode.'
      },
      businessLicense: {
        ok: true,
        expectedType: 'business_license',
        confidence: 1,
        extractedBusinessName: String(mapDisplayName || '').trim().slice(0, 120),
        extractedAddressHint: '',
        ocrText: '',
        errors: [],
        reason: 'Accepted in temporary permissive mode.'
      },
      ownerIdentity: {
        ok: true,
        expectedType: 'owner_id',
        confidence: 1,
        extractedBusinessName: '',
        extractedAddressHint: '',
        ocrText: '',
        errors: [],
        reason: 'Accepted in temporary permissive mode.'
      }
    }
  };
}
