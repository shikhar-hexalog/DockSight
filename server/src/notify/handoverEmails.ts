// Customer emails for submitted handovers, each parcel emailed once:
// - Dispatch: "Your order has been dispatched", one per parcel that cleared the
//   handover check (AWB, courier, time).
// - Returns: "We've received your return", one per matched dock scan (return
//   number, AWB, items, condition on arrival, courier, time).
// Both attach the handover's signed sheet.
//
// - Sent when the handover is submitted, and again for any scan that reaches
//   the server after that (the desk syncs scans and the submit separately, so
//   after being offline the submit can arrive first).
// - Parcels already emailed are skipped, and a handover being sent right now
//   is not started twice, so a repeated submit never emails anyone twice.
// - Anything that failed is retried every few minutes.
//
// Demo: Uniware masks customer emails, so every email goes to MAIL_DEMO_TO
// instead. Sent through Microsoft Graph (see mailer.ts).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BatchKind, type DispatchNotice, HandoverResult, PARCEL_CONDITION_LABEL, type ParcelCondition, ScanResult } from '@hexabuild/shared';

import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';
import { UPLOADS_DIR, UPLOAD_NAME } from '../lib/uploads.ts';
import { type Attachment, type Email, MAX_ATTACHMENT_BYTES, mailReady, sendEmail } from './mailer.ts';

const RETRY_EVERY_MS = 5 * 60_000;

// Older handovers are left alone: their customers have long had the parcel.
const RETRY_WITHIN_MS = 2 * 24 * 60 * 60_000;

/** Handovers whose emails are being sent right now. */
const sending = new Set<string>();

function toNotice(row: Record<string, unknown>): DispatchNotice {
  return {
    batchId: String(row.batch_id),
    kind: row.kind === BatchKind.RECEIVE ? 'RECEIVE' : 'DISPATCH',
    courier: String(row.courier),
    recipient: row.recipient === null ? null : String(row.recipient),
    sent: Number(row.sent),
    failed: Number(row.failed),
    error: row.error === null ? null : String(row.error),
    notifiedAt: String(row.notified_at),
  };
}

const escape = (text: string) => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

const CONTENT_TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** The handover's signed sheet, read once for all its emails: attached, too big to attach, or none. */
type Sheet = { attachment: Attachment } | { tooBig: true } | null;

function sheetFor(file: string | null, courier: string, submittedAt: string): Sheet {
  if (!file || !UPLOAD_NAME.test(file)) {
    return null;
  }

  const path = join(UPLOADS_DIR, file);

  if (!existsSync(path)) {
    return null;
  }

  if (statSync(path).size > MAX_ATTACHMENT_BYTES) {
    return { tooBig: true };
  }

  const extension = file.split('.').pop()!;

  const day = submittedAt.slice(0, 10);

  return {
    attachment: {
      name: `signed-handover-sheet-${courier.replace(/[^\w-]+/g, '-')}-${day}.${extension}`,
      contentType: CONTENT_TYPE[extension] ?? 'application/octet-stream',
      data: readFileSync(path),
    },
  };
}

function sheetLine(sheet: Sheet): string | null {
  if (!sheet) {
    return null;
  }

  return 'attachment' in sheet ? 'The handover sheet signed by our team and the courier rider is attached.' : 'The signed handover sheet was too large to attach to this email.';
}

interface Handover {
  id: string;
  kind: BatchKind;
  courier: string;
  vehicleNo: string | null;
  submittedAt: string;
  sheet: Sheet;
}

/** One email to send, and how to record that it went. */
interface Pending {
  id: string;
  email: Omit<Email, 'to'>;
}

/** A small table of label/value rows, for both kinds of email. */
function detailsHtml(rows: [string, string][]): string {
  return `<table cellpadding="4">\n${rows.map(([label, value]) => `<tr><td>${escape(label)}</td><td>${value}</td></tr>`).join('\n')}\n</table>`;
}

function finish(handover: Handover, lines: { intro: string; rows: [string, string][]; outro: string }, subject: string): Omit<Email, 'to'> {
  const note = sheetLine(handover.sheet);

  const text = [
    'Hello,',
    '',
    lines.intro,
    '',
    ...lines.rows.map(([label, value]) => `${label}: ${value.replace(/<[^>]+>/g, '')}`),
    '',
    lines.outro,
    ...(note ? ['', note] : []),
    '',
    'Hexalog Warehouse',
  ].join('\n');

  const html = `<p>Hello,</p>
<p>${escape(lines.intro)}</p>
${detailsHtml(lines.rows)}
<p>${escape(lines.outro)}</p>${note ? `\n<p>${escape(note)}</p>` : ''}
<p>Hexalog Warehouse</p>`;

  return { subject, text, html, attachments: handover.sheet && 'attachment' in handover.sheet ? [handover.sheet.attachment] : [] };
}

const courierLine = (h: Handover) => escape(`${h.courier}${h.vehicleNo ? ` (vehicle ${h.vehicleNo})` : ''}`);

/** Dispatch: cleared parcels without an email yet. */
function pendingDispatch(h: Handover): Pending[] {
  const rows = db
    .prepare(
      `SELECT hc.id, hc.code FROM handover_checks hc
       WHERE hc.batch_id = ? AND hc.result = ? AND NOT EXISTS (SELECT 1 FROM dispatch_emails de WHERE de.check_id = hc.id)
       ORDER BY hc.checked_at`
    )
    .all(h.id, HandoverResult.CLEAR) as { id: string; code: string }[];

  return rows.map(row => ({
    id: row.id,
    email: finish(
      h,
      {
        intro: `Your order has left our warehouse and is on its way with ${h.courier}.`,
        rows: [
          ['Tracking number (AWB)', `<b>${escape(row.code)}</b>`],
          ['Courier', courierLine(h)],
          ['Dispatched', escape(formatTime(h.submittedAt))],
        ],
        outro: 'You can track it on the courier website with the AWB above.',
      },
      `Your order has been dispatched · AWB ${row.code}`
    ),
  }));
}

const RETURN_TYPE_LABEL: Record<string, string> = { RTO: 'Return to origin (undelivered)', CIR: 'Customer return' };

/** Returns: matched dock scans without an email yet, with their return and items. */
function pendingReturns(h: Handover): Pending[] {
  const rows = db
    .prepare(
      `SELECT rc.id, rc.code, rc.scanned_at, rc.condition, rc.condition_note, r.id AS return_id, r.source_code, r.type
       FROM receipts rc JOIN returns r ON r.id = rc.return_id
       WHERE rc.batch_id = ? AND rc.result = ? AND NOT EXISTS (SELECT 1 FROM return_emails re WHERE re.receipt_id = rc.id)
       ORDER BY rc.scanned_at`
    )
    .all(h.id, ScanResult.MATCHED) as {
    id: string;
    code: string;
    scanned_at: string;
    condition: ParcelCondition | null;
    condition_note: string | null;
    return_id: string;
    source_code: string;
    type: string;
  }[];

  const itemsOf = db.prepare('SELECT item_name, sku_code FROM return_items WHERE return_id = ? ORDER BY sale_order_item_code');

  return rows.map(row => {
    const items = itemsOf.all(row.return_id) as { item_name: string | null; sku_code: string | null }[];

    const itemList = items.length
      ? items.map(item => `${escape(item.item_name ?? 'Item')}${item.sku_code ? ` <span style="color:#777">(${escape(item.sku_code)})</span>` : ''}`).join('<br>')
      : 'Details not available';

    const condition = row.condition
      ? `${escape(PARCEL_CONDITION_LABEL[row.condition] ?? row.condition)}${row.condition_note ? ` · ${escape(row.condition_note)}` : ''}`
      : 'Outer packaging intact';

    return {
      id: row.id,
      email: finish(
        h,
        {
          intro: `We've received your return at our warehouse from ${h.courier}.`,
          rows: [
            ['Return number', `<b>${escape(row.source_code)}</b>`],
            ['Tracking number (AWB)', escape(row.code)],
            ['Type', escape(RETURN_TYPE_LABEL[row.type] ?? row.type)],
            [items.length > 1 ? 'Items' : 'Item', itemList],
            ['Condition on arrival', condition],
            ['Courier', courierLine(h)],
            ['Received', escape(formatTime(row.scanned_at))],
          ],
          outro: "It now goes through a quality check. We'll update you once it's processed.",
        },
        `We've received your return · ${row.source_code}`
      ),
    };
  });
}

/** Emails a submitted handover's parcels that haven't had one yet. */
export async function notifyHandover(batchId: string): Promise<DispatchNotice | null> {
  if (sending.has(batchId)) {
    return null;
  }

  const batch = db.prepare('SELECT kind, courier, vehicle_no, submitted_at, signed_sheet FROM receiving_batches WHERE id = ?').get(batchId);

  if (!batch || !batch.submitted_at || (batch.kind !== BatchKind.DISPATCH && batch.kind !== BatchKind.RECEIVE)) {
    return null;
  }

  sending.add(batchId);

  try {
    const courier = String(batch.courier);

    const submittedAt = String(batch.submitted_at);

    return await sendPending({
      id: batchId,
      kind: batch.kind as BatchKind,
      courier,
      vehicleNo: batch.vehicle_no === null ? null : String(batch.vehicle_no),
      submittedAt,
      // Read once and attached to every email of this handover.
      sheet: sheetFor(batch.signed_sheet === null ? null : String(batch.signed_sheet), courier, submittedAt),
    });
  } finally {
    sending.delete(batchId);
  }
}

async function sendPending(h: Handover): Promise<DispatchNotice | null> {
  const isDispatch = h.kind === BatchKind.DISPATCH;

  const pending = isDispatch ? pendingDispatch(h) : pendingReturns(h);

  // Nothing new: no row is written, so scans that arrive later still get theirs.
  if (pending.length === 0) {
    return null;
  }

  const recipient = config.mail.demoTo ?? null;

  const sentTable = isDispatch ? 'dispatch_emails' : 'return_emails';

  const markSent = db.prepare(`INSERT OR IGNORE INTO ${sentTable} (${isDispatch ? 'check_id' : 'receipt_id'}, batch_id, sent_at) VALUES (?, ?, ?)`);

  let sentNow = 0;

  let error: string | null = recipient ? null : 'MAIL_DEMO_TO is not set in .env';

  if (recipient) {
    for (const item of pending) {
      try {
        await sendEmail({ to: recipient, ...item.email });

        // Recorded one by one, so a crash part-way never resends the ones that went.
        markSent.run(item.id, h.id, nowIso());

        sentNow++;
      } catch (err) {
        error ??= (err as Error).message;
      }
    }
  }

  const sent = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${sentTable} WHERE batch_id = ?`).get(h.id)?.n ?? 0);

  const notice: DispatchNotice = {
    batchId: h.id,
    kind: isDispatch ? 'DISPATCH' : 'RECEIVE',
    courier: h.courier,
    recipient,
    sent,
    failed: pending.length - sentNow,
    error,
    notifiedAt: nowIso(),
  };

  db.prepare(
    `INSERT INTO dispatch_notices (batch_id, kind, courier, recipient, sent, failed, error, notified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (batch_id) DO UPDATE SET recipient = excluded.recipient, sent = excluded.sent, failed = excluded.failed,
       error = excluded.error, notified_at = excluded.notified_at`
  ).run(h.id, h.kind, h.courier, recipient, sent, notice.failed, error, notice.notifiedAt);

  console.log(`[mail] ${isDispatch ? 'dispatch' : 'returns'} ${h.courier}: ${sentNow} sent, ${notice.failed} failed${error ? ` (${error})` : ''}`);

  return notice;
}

/** Submitted handovers from the last two days with parcels not yet emailed. */
function handoversWithPending(): string[] {
  const since = new Date(Date.now() - RETRY_WITHIN_MS).toISOString();

  return db
    .prepare(
      `SELECT DISTINCT b.id FROM receiving_batches b
       JOIN handover_checks hc ON hc.batch_id = b.id AND hc.result = ?
       WHERE b.kind = ? AND b.submitted_at IS NOT NULL AND b.submitted_at >= ?
         AND NOT EXISTS (SELECT 1 FROM dispatch_emails de WHERE de.check_id = hc.id)
       UNION
       SELECT DISTINCT b.id FROM receiving_batches b
       JOIN receipts rc ON rc.batch_id = b.id AND rc.result = ? AND rc.return_id IS NOT NULL
       WHERE b.kind = ? AND b.submitted_at IS NOT NULL AND b.submitted_at >= ?
         AND NOT EXISTS (SELECT 1 FROM return_emails re WHERE re.receipt_id = rc.id)`
    )
    .all(HandoverResult.CLEAR, BatchKind.DISPATCH, since, ScanResult.MATCHED, BatchKind.RECEIVE, since)
    .map(row => String(row.id));
}

/** Retries emails that didn't go out (mail not set up, scans that arrived late). Returns a stop function. */
export function startHandoverEmailRetry(): () => void {
  console.log(
    mailReady
      ? `[mail] dispatch and return emails go through Microsoft Graph, from ${config.mail.from}${config.mail.demoTo ? ` to ${config.mail.demoTo} (demo)` : ''}`
      : '[mail] dispatch and return emails are off: Microsoft Graph is not set up (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET)'
  );

  const timer = setInterval(() => {
    void (async () => {
      for (const batchId of handoversWithPending()) {
        await notifyHandover(batchId).catch(err => console.error('[mail] handover email retry failed:', err));
      }
    })();
  }, RETRY_EVERY_MS);

  return () => clearInterval(timer);
}

export function listDispatchNotices(since: string): DispatchNotice[] {
  return db
    .prepare('SELECT * FROM dispatch_notices WHERE notified_at >= ? ORDER BY notified_at DESC')
    .all(since)
    .map(row => toNotice(row as Record<string, unknown>));
}
