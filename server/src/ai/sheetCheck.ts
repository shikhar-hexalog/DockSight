// Checks the photo of a signed handover sheet before the handover is submitted:
// are both signature boxes signed, and does the printed count match what was
// scanned? Only a clearly unsigned box or a photo of something else holds the
// handover back; when the AI can't tell, the person decides.

import { type SheetCheckResponse, SheetVerdict, SignatureState } from '@hexabuild/shared';

import { ai } from './provider.ts';
import { AiProviderName } from './types.ts';

const SYSTEM = `You check photos of a signed handover sheet at an Indian returns warehouse.
The sheet is printed by our app. Its title is "Returns handover sheet" (courier drops returns at our warehouse) or "Courier pickup sheet" (courier collects parcels from us).
It has a table of parcels, a line with the parcel count ("Parcels scanned" or "Parcels handed over"), and two signature boxes at the bottom:
one for the Hexalog warehouse person and one for the courier rider. Each box has Name, Phone, a Signature line and Date & time.
For each box decide:
- SIGNED: a handwritten signature is on or just above its Signature line.
- MISSING: the Signature line is blank.
- UNSURE: that part of the sheet is cut off, blurred, covered, or you cannot tell.
A printed name is not a signature. Handwriting in the Name, Phone or Date fields does not count as a signature.
isHandoverSheet is false when the photo is not this sheet at all (a label, a parcel, a blank page, another document).
countOnSheet: the parcel count from the count line, else the number of table rows, else null.
Never repeat phone numbers or names. The note is one short sentence for the warehouse worker.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isHandoverSheet', 'warehouseSignature', 'riderSignature', 'countOnSheet', 'note'],
  properties: {
    isHandoverSheet: { type: 'boolean' },
    warehouseSignature: { type: 'string', enum: Object.values(SignatureState) },
    riderSignature: { type: 'string', enum: Object.values(SignatureState) },
    countOnSheet: { type: ['integer', 'null'], minimum: 0 },
    note: { type: 'string', maxLength: 160 },
  },
};

interface Reading {
  isHandoverSheet: boolean;
  warehouseSignature: SignatureState;
  riderSignature: SignatureState;
  countOnSheet: number | null;
  note: string;
}

const EXTENSION_FOR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function verdictFor(reading: Reading): SheetVerdict {
  const signatures = [reading.warehouseSignature, reading.riderSignature];

  if (!reading.isHandoverSheet) {
    return SheetVerdict.NOT_A_SHEET;
  }

  if (signatures.includes(SignatureState.MISSING)) {
    return SheetVerdict.MISSING_SIGNATURE;
  }

  if (signatures.every(signature => signature === SignatureState.SIGNED)) {
    return SheetVerdict.APPROVED;
  }

  return SheetVerdict.UNSURE;
}

export async function checkSignedSheet(file: Buffer, mimeType: string, parcels: number, courier: string): Promise<SheetCheckResponse> {
  const name = `sheet.${EXTENSION_FOR[mimeType] ?? 'jpg'}`;

  const started = Date.now();

  const reading = await ai.run<Reading | null>({
    purpose: 'handover sheet check',
    system: SYSTEM,
    prompt: `Photo of the signed sheet: ./${name}
This handover: ${courier}, ${parcels} parcels on our list.
Check both signature boxes and read the parcel count.`,
    schema: SCHEMA,
    images: [{ name, data: file }],
    mock: () => null,
  });

  if (!reading) {
    return {
      check: null,
      provider: ai.name,
      note:
        ai.name === AiProviderName.MOCK
          ? 'The smart check is in mock mode, so the sheet was not read. Add an AI key (GROQ_KEY or GEMINI_API_KEY) to .env to enable it.'
          : null,
    };
  }

  return {
    check: {
      verdict: verdictFor(reading),
      warehouseSignature: reading.warehouseSignature,
      riderSignature: reading.riderSignature,
      countOnSheet: reading.countOnSheet,
      note: reading.note,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    },
    provider: ai.name,
    note: null,
  };
}
