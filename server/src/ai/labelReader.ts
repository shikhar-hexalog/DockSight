// Damaged-label fallback: when a barcode won't scan, a photo of the label is
// read by the AI. Its readings are only suggestions; each is checked against
// the returns we actually expect, and the person picks the right one.

import { type LabelCandidate, type LabelReadResponse, normalizeCode } from '@hexabuild/shared';

import { getDeskReturnById } from '../repo/receivingRepo.ts';
import { findReturnIdByCode } from '../repo/returnsRepo.ts';
import { ai } from './provider.ts';
import { AiProviderName } from './types.ts';

const IMAGE_NAME = 'label';

const MAX_CANDIDATES = 6;

const SYSTEM = `You read Indian courier shipping labels (Delhivery, Blue Dart, Ekart, Xpressbees, Shadowfax, DTDC and others).
Rules:
- Report only characters you can actually see. Never guess or complete partly hidden codes.
- Codes are case-sensitive as printed; drop spaces inside a code.
- The AWB / tracking number is usually printed under the main barcode, often 10-16 digits or letters + digits.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['codes', 'courier'],
  properties: {
    codes: {
      type: 'array',
      maxItems: MAX_CANDIDATES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'kind', 'confidence'],
        properties: {
          value: { type: 'string' },
          kind: { type: 'string', enum: ['AWB', 'order', 'shipment', 'return', 'other'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    courier: { type: ['string', 'null'] },
  },
};

interface Reading {
  codes: { value: string; kind: string; confidence: number }[];
  courier: string | null;
}

const EXTENSION_FOR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function readLabel(image: Buffer, mimeType: string): Promise<LabelReadResponse> {
  const name = `${IMAGE_NAME}.${EXTENSION_FOR[mimeType] ?? 'jpg'}`;

  const reading = await ai.run<Reading>({
    purpose: 'label read',
    system: SYSTEM,
    prompt: `Read the shipping label in ./${name}. List every code you can read (AWB first), and the courier if printed.`,
    schema: SCHEMA,
    images: [{ name, data: image }],
    mock: () => ({ codes: [], courier: null }),
  });

  const seen = new Set<string>();

  const candidates: LabelCandidate[] = reading.codes
    .map(code => ({ ...code, value: normalizeCode(code.value) }))
    .filter(code => code.value.length >= 3 && !seen.has(code.value) && seen.add(code.value))
    .map(code => {
      const returnId = findReturnIdByCode(code.value);

      const match = returnId ? getDeskReturnById(returnId) : null;

      return {
        code: code.value,
        kind: code.kind,
        confidence: code.confidence,
        match: match
          ? { returnId: match.id, sourceCode: match.sourceCode, type: match.type, courier: match.courier, stage: match.stage }
          : null,
      };
    })
    // Codes that match an expected return first, then by confidence.
    .sort((a, b) => Number(b.match !== null) - Number(a.match !== null) || b.confidence - a.confidence);

  return {
    candidates,
    courier: reading.courier,
    provider: ai.name,
    note: ai.name === AiProviderName.MOCK ? 'Smart label reading is in mock mode, so the label was not read. Add an AI key (GROQ_KEY or GEMINI_API_KEY) to .env to enable it.' : null,
  };
}
