import { join } from 'node:path';

import { Router } from 'express';
import { z } from 'zod';

import {
  BatchKind,
  type BatchDetailResponse,
  type BatchesResponse,
  type DeskOp,
  DeskOpKind,
  type DeskOpResult,
  type DeskOpsResponse,
  PARCEL_CONDITIONS,
  type Receipt,
  type ReceiptsResponse,
  type ReceiveResponse,
  ScanResult,
  type SheetImportResponse,
} from '@hexabuild/shared';

import { UPLOADS_DIR, UPLOAD_NAME } from '../lib/uploads.ts';
import { notifyHandover } from '../notify/handoverEmails.ts';
import { batchParcels, discardBatch, getBatch, listBatches, setCondition, startBatch, submitBatch } from '../repo/batchesRepo.ts';
import { removeHandoverCheck } from '../repo/dispatchRepo.ts';
import { getDeskManifest, importSheet, listReceipts, recordScan, removeReceipt, resolveReceipt } from '../repo/receivingRepo.ts';
import { findReturnIdByCode } from '../repo/returnsRepo.ts';
import type { SyncService } from '../sync/syncService.ts';

// A desk that was offline for a while can send a lot at once.
const MAX_BATCH = 500;

const scanSchema = z.object({
  id: z.uuid(),
  code: z.string().trim().min(3).max(64),
  scannedBy: z.string().trim().min(1).max(60),
  scannedAt: z.iso.datetime(),
  batchId: z.uuid().optional(),
});

const IMAGE = z.string().max(12_000_000).startsWith('data:image/');

// The signed sheet can also be a scanned PDF.
const IMAGE_OR_PDF = z
  .string()
  .max(12_000_000)
  .refine(value => value.startsWith('data:image/') || value.startsWith('data:application/pdf'), 'Must be an image or a PDF');

const opSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(DeskOpKind.BATCH_START),
    id: z.uuid(),
    // Desks from before dispatch handovers send none: those are receiving.
    batchKind: z.enum([BatchKind.RECEIVE, BatchKind.DISPATCH]).default(BatchKind.RECEIVE),
    courier: z.string().trim().min(1).max(60),
    vehicleNo: z.string().trim().max(30).nullable(),
    scannedBy: z.string().trim().min(1).max(60),
    startedAt: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal(DeskOpKind.CONDITION),
    id: z.uuid(),
    scanId: z.uuid(),
    condition: z.enum(PARCEL_CONDITIONS).nullable(),
    note: z.string().trim().max(300).nullable(),
    photo: IMAGE.nullable(),
    updatedAt: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal(DeskOpKind.BATCH_SUBMIT),
    id: z.uuid(),
    batchId: z.uuid(),
    courierCount: z.number().int().min(0).max(100_000),
    signedSheet: IMAGE_OR_PDF,
    submittedBy: z.string().trim().min(1).max(60),
    submittedAt: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal(DeskOpKind.BATCH_DISCARD),
    id: z.uuid(),
    batchId: z.uuid(),
    discardedBy: z.string().trim().min(1).max(60),
    discardedAt: z.iso.datetime(),
  }),
]);

const removeOp = z.object({
  kind: z.enum([DeskOpKind.SCAN_REMOVE, DeskOpKind.CHECK_REMOVE]),
  id: z.uuid(),
  scanId: z.uuid(),
  removedBy: z.string().trim().min(1).max(60),
  removedAt: z.iso.datetime(),
});

const opsBody = z.object({ ops: z.array(z.unknown()).min(1).max(50) });

const batchesQuery = z.object({ since: z.iso.datetime().optional() });

function applyOp(op: DeskOp) {
  if (op.kind === DeskOpKind.BATCH_START) {
    startBatch(op);
  } else if (op.kind === DeskOpKind.CONDITION) {
    setCondition(op);
  } else if (op.kind === DeskOpKind.BATCH_SUBMIT) {
    submitBatch(op);
  } else if (op.kind === DeskOpKind.BATCH_DISCARD) {
    discardBatch(op);
  } else if (op.kind === DeskOpKind.SCAN_REMOVE) {
    removeReceipt(op.scanId, op.removedBy, op.removedAt);
  } else {
    removeHandoverCheck(op.scanId);
  }
}

// Each scan is checked on its own: one malformed scan is rejected alone
// instead of failing the batch and leaving the desk's outbox stuck.
const scansBody = z.object({ scans: z.array(z.unknown()).min(1).max(MAX_BATCH) });

const receiptsQuery = z.object({
  since: z.iso.datetime().optional(),
  exceptions: z.stringbool().optional(),
  open: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

// A month of a busy dock fits comfortably.
const MAX_SHEET_ROWS = 50_000;

const sheetImportBody = z.object({
  importedBy: z.string().trim().min(1).max(60),
  dryRun: z.boolean(),
  rows: z
    .array(
      z.object({
        line: z.number().int(),
        awb: z.string().trim().min(3).max(64),
        receivedAt: z.iso.datetime(),
        vehicleNo: z.string().trim().max(40).nullable(),
        courier: z.string().trim().max(60).nullable(),
        type: z.string().trim().max(20).nullable(),
        remarks: z.string().trim().max(500).nullable(),
      })
    )
    .min(1)
    .max(MAX_SHEET_ROWS),
});

const resolveBody = z.object({
  resolvedBy: z.string().trim().min(1).max(60),
  note: z.string().trim().min(1).max(500),
});

function rejected(raw: unknown, reason: string): Receipt {
  const value = (raw ?? {}) as { id?: unknown; code?: unknown };

  return {
    id: typeof value.id === 'string' ? value.id : 'unknown',
    code: typeof value.code === 'string' ? value.code : '',
    result: ScanResult.UNEXPECTED,
    returnId: null,
    type: null,
    sourceCode: null,
    courier: null,
    saleOrderCode: null,
    reversePickupCode: null,
    firstItemName: null,
    scannedBy: '',
    scannedAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: `Invalid scan: ${reason}`,
    batchId: null,
    condition: null,
    conditionNote: null,
    conditionPhotoUrl: null,
  };
}

export function receivingRouter(sync: SyncService) {
  const router = Router();

  router.get('/desk/manifest', (_req, res) => {
    res.json(getDeskManifest());
  });

  // Applied in the order the desk sends them, which is the order they were scanned.
  router.post('/desk/scans', async (req, res) => {
    const { scans } = scansBody.parse(req.body);

    const results: Receipt[] = [];

    const handovers = new Set<string>();

    for (const raw of scans) {
      const parsed = scanSchema.safeParse(raw);

      if (!parsed.success) {
        results.push(rejected(raw, parsed.error.issues[0]?.message ?? 'invalid'));
        continue;
      }

      if (parsed.data.batchId) {
        handovers.add(parsed.data.batchId);
      }

      // A code we don't know may be a return Uniware has that we haven't synced yet.
      if (!findReturnIdByCode(parsed.data.code)) {
        await sync.lookup(parsed.data.code).catch(() => null);
      }

      results.push(recordScan(parsed.data));
    }

    const body: ReceiveResponse = { results };

    res.json(body);

    // Scans can reach the server after their handover was submitted: email those customers too.
    // notifyHandover ignores handovers that aren't submitted yet.
    setImmediate(() => {
      for (const batchId of handovers) {
        void notifyHandover(batchId).catch(err => console.error('[mail] return emails failed:', err));
      }
    });
  });

  // Batch starts, condition tags and submissions, in the order they happened.
  router.post('/desk/ops', (req, res) => {
    const { ops } = opsBody.parse(req.body);

    const results: DeskOpResult[] = ops.map(raw => {
      const parsed = opSchema.or(removeOp).safeParse(raw);

      const id = typeof (raw as { id?: unknown })?.id === 'string' ? String((raw as { id: string }).id) : 'unknown';

      if (!parsed.success) {
        return { id, ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
      }

      try {
        applyOp(parsed.data);

        // Emails go out after the response; a slow mail server never holds up the desk.
        if (parsed.data.kind === DeskOpKind.BATCH_SUBMIT) {
          const { batchId } = parsed.data;

          setImmediate(() => void notifyHandover(batchId).catch(err => console.error('[mail] handover emails failed:', err)));
        }

        return { id, ok: true, error: null };
      } catch (err) {
        return { id, ok: false, error: (err as Error).message };
      }
    });

    const body: DeskOpsResponse = { results };

    res.json(body);
  });

  router.get('/desk/batches', (req, res) => {
    const { since } = batchesQuery.parse(req.query);

    const start = new Date();

    start.setHours(0, 0, 0, 0);

    const body: BatchesResponse = { data: listBatches(since ?? start.toISOString()) };

    res.json(body);
  });

  router.get('/desk/batches/:id', (req, res) => {
    const batch = getBatch(req.params.id);

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const body: BatchDetailResponse = { batch, parcels: batchParcels(batch.id) };

    res.json(body);
  });

  router.get('/uploads/:name', (req, res) => {
    if (!UPLOAD_NAME.test(req.params.name)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.sendFile(join(UPLOADS_DIR, req.params.name), { maxAge: '30d', immutable: true });
  });

  router.post('/desk/sheet-import', (req, res) => {
    const { rows, importedBy, dryRun } = sheetImportBody.parse(req.body);

    // Oldest first, so the first arrival of a repeated AWB is the one kept.
    const ordered = [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

    const body: SheetImportResponse = importSheet(ordered, importedBy, dryRun);

    res.json(body);
  });

  router.get('/receipts', (req, res) => {
    const query = receiptsQuery.parse(req.query);

    const body: ReceiptsResponse = {
      data: listReceipts({
        since: query.since,
        exceptionsOnly: query.exceptions,
        openOnly: query.open,
        limit: query.limit,
      }),
    };

    res.json(body);
  });

  router.post('/receipts/:id/resolve', (req, res) => {
    const { resolvedBy, note } = resolveBody.parse(req.body);

    const receipt = resolveReceipt(req.params.id, resolvedBy, note);

    if (!receipt) {
      res.status(404).json({ error: 'Scan not found' });
      return;
    }

    res.json(receipt);
  });

  return router;
}
