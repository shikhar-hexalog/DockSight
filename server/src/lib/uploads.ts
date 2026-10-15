// Photos from the desk (signed handover sheets, damaged parcels), stored as
// files next to the database and served back by name.

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config } from '../config.ts';

export const UPLOADS_DIR = join(dirname(config.dbPath), 'uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_BYTES = 8 * 1024 * 1024;

const IMAGE_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PDF_TYPE = 'application/pdf';

// Every PDF file starts with these bytes; a renamed file of another kind won't.
const PDF_MAGIC = '%PDF-';

const DATA_URL = /^data:([a-z]+\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/;

/** Names we create: safe to serve back without path tricks. */
export const UPLOAD_NAME = /^[a-z]+-[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

/**
 * Saves an uploaded image (or, with allowPdf, a PDF) from a data URL;
 * returns its file name. PDFs are for scanned documents like signed sheets.
 */
export function saveImage(dataUrl: string, prefix: string, { allowPdf = false } = {}): string {
  const match = DATA_URL.exec(dataUrl);

  const type = match?.[1] ?? '';

  const extension = IMAGE_EXTENSION[type] ?? (allowPdf && type === PDF_TYPE ? 'pdf' : undefined);

  if (!match || !extension) {
    throw new Error(allowPdf ? 'File must be a JPEG, PNG or WebP image, or a PDF' : 'Photo must be a JPEG, PNG or WebP image');
  }

  const bytes = Buffer.from(match[2], 'base64');

  if (extension === 'pdf' && bytes.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    throw new Error('That file is not a valid PDF');
  }

  if (bytes.length > MAX_BYTES) {
    throw new Error('File is larger than 8 MB');
  }

  const name = `${prefix}-${randomUUID()}.${extension}`;

  writeFileSync(join(UPLOADS_DIR, name), bytes);

  return name;
}

export const uploadUrl = (name: string | null) => (name ? `/api/uploads/${name}` : null);
