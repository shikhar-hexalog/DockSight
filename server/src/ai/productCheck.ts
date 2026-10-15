// QC step one: the AI compares a photo of what came back with the catalogue
// images of what was sold. Same product, colour and print? A clear mismatch
// (a different product swapped in) fails QC there and then; a match goes on to
// the person's condition check. It only advises: the person can overrule it.
// The AI sees the photo, product names and catalogue images, never customer
// details, and is told to ignore any shipping label in the shot.

import { type ItemMatch, MatchVerdict, type QcCheckResponse } from '@hexabuild/shared';

import { expectedItemsFor } from '../repo/workflowRepo.ts';
import { ai } from './provider.ts';
import { AiProviderName } from './types.ts';

const MAX_ITEMS = 4;

const CATALOG_TIMEOUT_MS = 10_000;

const MAX_CATALOG_BYTES = 5 * 1024 * 1024;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const EXTENSION_FOR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const SYSTEM = `You are the first quality check for returned e-commerce products (fashion, beauty, home) at an Indian warehouse.
Compare the photo of what came back with the catalogue image of each item that was sold, and decide if it is the same product.
Check: product type (dress vs top vs bag), colour, print or pattern, and distinctive details (neckline, sleeves, logo, shape).
Ignore: lighting, folds, creases, polybags or packaging, background, angle, and the item being turned inside out.
Do not judge condition (stains, damage, tags): a person checks that next.
MATCH: clearly the same product. MISMATCH: clearly a different product or colour. UNSURE: not visible, photo unclear, or you cannot tell.
Ignore shipping labels and any names, phone numbers or addresses in the photo. Never repeat them.`;

interface Reading {
  items: { code: string; verdict: MatchVerdict; expected: string; observed: string }[];
  note: string;
}

function schemaFor(codes: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'note'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'verdict', 'expected', 'observed'],
          properties: {
            code: { type: 'string', enum: codes },
            verdict: { type: 'string', enum: Object.values(MatchVerdict) },
            expected: { type: 'string', maxLength: 60 },
            observed: { type: 'string', maxLength: 80 },
          },
        },
      },
      note: { type: 'string', maxLength: 200 },
    },
  };
}

/** A catalogue image from the item's Uniware record, or null if it can't be fetched. */
async function fetchCatalogImage(url: string | null): Promise<{ data: Buffer; extension: string } | null> {
  if (!url?.startsWith('https://')) {
    return null;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });

    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();

    const extension = EXTENSION_FOR[type];

    if (!res.ok || !extension) {
      return null;
    }

    const data = Buffer.from(await res.arrayBuffer());

    return data.length <= MAX_CATALOG_BYTES ? { data, extension } : null;
  } catch {
    return null;
  }
}

/** Any wrong item fails the parcel; all matching passes it; anything else is the person's call. */
function overall(items: ItemMatch[]): MatchVerdict {
  if (items.some(item => item.verdict === MatchVerdict.MISMATCH)) {
    return MatchVerdict.MISMATCH;
  }

  if (items.length > 0 && items.every(item => item.verdict === MatchVerdict.MATCH)) {
    return MatchVerdict.MATCH;
  }

  return MatchVerdict.UNSURE;
}

export async function checkProduct(returnId: string, photo: string): Promise<QcCheckResponse> {
  const match = DATA_URL.exec(photo);

  if (!match) {
    throw new Error('Photo must be a JPEG, PNG or WebP image');
  }

  const expected = expectedItemsFor(returnId).slice(0, MAX_ITEMS);

  if (expected.length === 0) {
    throw new Error('This return has no items to compare with');
  }

  const parcelName = `parcel.${EXTENSION_FOR[match[1]]}`;

  const images: { name: string; data: Buffer }[] = [{ name: parcelName, data: Buffer.from(match[2], 'base64') }];

  const lines: string[] = [];

  for (const [index, item] of expected.entries()) {
    const catalog = await fetchCatalogImage(item.imageUrl);

    if (catalog) {
      const name = `expected-${index + 1}.${catalog.extension}`;

      images.push({ name, data: catalog.data });

      lines.push(`${index + 1}. code ${item.code}: "${item.name}", catalogue image ./${name}`);
    } else {
      lines.push(`${index + 1}. code ${item.code}: "${item.name}" (no catalogue image: judge from the name)`);
    }
  }

  const started = Date.now();

  const reading = await ai.run<Reading | null>({
    purpose: 'qc product check',
    system: SYSTEM,
    prompt: `Photo of what came back in the parcel: ./${parcelName}
Items that were sold:
${lines.join('\n')}

Give a verdict for every item: expected (what the catalogue shows, a few words), observed (what the photo shows for it).
Then one short note for the warehouse worker.`,
    schema: schemaFor(expected.map(item => item.code)),
    images,
    mock: () => null,
  });

  if (!reading) {
    return {
      check: null,
      provider: ai.name,
      note: ai.name === AiProviderName.MOCK ? 'AI is in mock mode, so the photo was not checked. Install the Claude CLI to enable it.' : null,
    };
  }

  // Every expected item gets a verdict, even one the model skipped.
  const items: ItemMatch[] = expected.map(item => {
    const found = reading.items.find(answer => answer.code === item.code);

    return found ?? { code: item.code, verdict: MatchVerdict.UNSURE, expected: item.name, observed: 'Not checked' };
  });

  return {
    check: { verdict: overall(items), items, note: reading.note, seconds: Math.round((Date.now() - started) / 100) / 10 },
    provider: ai.name,
    note: null,
  };
}
