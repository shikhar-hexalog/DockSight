// "Your order has been dispatched" emails for a submitted dispatch handover:
// one per parcel that cleared the handover check, each sent once.
//
// - Sent when the handover is submitted, and again for any cleared scan that
//   reaches the server after that (the desk syncs scans and the submit
//   separately, so after being offline the submit can arrive first).
// - Parcels already emailed are skipped, and a handover being sent right now
//   is not started twice, so a repeated submit never emails anyone twice.
// - Anything that failed (mail server down) is retried every few minutes.
//
// Demo: Uniware masks customer emails, so every email goes to MAIL_DEMO_TO
// instead, through Mailpit unless SMTP_* says otherwise.

import { BatchKind, type DispatchNotice, HandoverResult } from '@hexabuild/shared';
import nodemailer from 'nodemailer';

import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';

const SEND_TIMEOUT_MS = 15_000;

const RETRY_EVERY_MS = 5 * 60_000;

// Older handovers are left alone: their customers have long had the parcel.
const RETRY_WITHIN_MS = 2 * 24 * 60 * 60_000;

/** Handovers whose emails are being sent right now. */
const sending = new Set<string>();

const transport = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.port === 465,
  auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  connectionTimeout: SEND_TIMEOUT_MS,
  greetingTimeout: SEND_TIMEOUT_MS,
  socketTimeout: SEND_TIMEOUT_MS,
});

interface Parcel {
  id: string;
  code: string;
  checkedAt: string;
}

function toNotice(row: Record<string, unknown>): DispatchNotice {
  return {
    batchId: String(row.batch_id),
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

function emailFor(parcel: Parcel, courier: string, vehicleNo: string | null, dispatchedAt: string) {
  const when = formatTime(dispatchedAt);

  const vehicle = vehicleNo ? ` (vehicle ${vehicleNo})` : '';

  const [awb, by] = [escape(parcel.code), escape(`${courier}${vehicle}`)];

  return {
    subject: `Your order has been dispatched · AWB ${parcel.code}`,
    text: [
      'Hello,',
      '',
      `Your order has left our warehouse and is on its way with ${courier}.`,
      '',
      `Tracking number (AWB): ${parcel.code}`,
      `Courier: ${courier}${vehicle}`,
      `Dispatched: ${when}`,
      '',
      'You can track it on the courier website with the AWB above.',
      '',
      'Hexalog Warehouse',
    ].join('\n'),
    html: `<p>Hello,</p>
<p>Your order has left our warehouse and is on its way with <b>${escape(courier)}</b>.</p>
<table cellpadding="4">
<tr><td>Tracking number (AWB)</td><td><b>${awb}</b></td></tr>
<tr><td>Courier</td><td>${by}</td></tr>
<tr><td>Dispatched</td><td>${when}</td></tr>
</table>
<p>You can track it on the courier website with the AWB above.</p>
<p>Hexalog Warehouse</p>`,
  };
}

const CONNECTION_CODES = new Set(['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'ECONNREFUSED', 'EDNS']);

function describeSendError({ message, code }: Error & { code?: string }): string {
  if (code && CONNECTION_CODES.has(code)) {
    return `can't reach the mail server at ${config.mail.host}:${config.mail.port} (is Mailpit running?)`;
  }

  return (message || code || 'the mail server did not accept it').slice(0, 200);
}

/** Emails the cleared parcels of a submitted dispatch handover that haven't had one yet. Receiving handovers are ignored. */
export async function notifyDispatch(batchId: string): Promise<DispatchNotice | null> {
  if (sending.has(batchId)) {
    return null;
  }

  const batch = db.prepare('SELECT kind, courier, vehicle_no, submitted_at FROM receiving_batches WHERE id = ?').get(batchId);

  if (!batch || batch.kind !== BatchKind.DISPATCH || !batch.submitted_at) {
    return null;
  }

  sending.add(batchId);

  try {
    return await sendPending(batchId, String(batch.courier), batch.vehicle_no === null ? null : String(batch.vehicle_no), String(batch.submitted_at));
  } finally {
    sending.delete(batchId);
  }
}

async function sendPending(batchId: string, courier: string, vehicleNo: string | null, submittedAt: string): Promise<DispatchNotice | null> {
  const pending = db
    .prepare(
      `SELECT hc.id, hc.code, hc.checked_at AS checkedAt FROM handover_checks hc
       WHERE hc.batch_id = ? AND hc.result = ? AND NOT EXISTS (SELECT 1 FROM dispatch_emails de WHERE de.check_id = hc.id)
       ORDER BY hc.checked_at`
    )
    .all(batchId, HandoverResult.CLEAR) as unknown as Parcel[];

  // Nothing new: no row is written, so scans that arrive later still get theirs.
  if (pending.length === 0) {
    return null;
  }

  const recipient = config.mail.demoTo ?? null;

  const markSent = db.prepare('INSERT OR IGNORE INTO dispatch_emails (check_id, batch_id, sent_at) VALUES (?, ?, ?)');

  let sentNow = 0;

  let error: string | null = recipient ? null : 'MAIL_DEMO_TO is not set in .env';

  if (recipient) {
    for (const parcel of pending) {
      try {
        await transport.sendMail({ from: `Hexalog Warehouse <${config.mail.from}>`, to: recipient, ...emailFor(parcel, courier, vehicleNo, submittedAt) });

        // Recorded one by one, so a crash part-way never resends the ones that went.
        markSent.run(parcel.id, batchId, nowIso());

        sentNow++;
      } catch (err) {
        error ??= describeSendError(err as Error & { code?: string });
      }
    }
  }

  const sent = Number(db.prepare('SELECT COUNT(*) AS n FROM dispatch_emails WHERE batch_id = ?').get(batchId)?.n ?? 0);

  const notice: DispatchNotice = { batchId, courier, recipient, sent, failed: pending.length - sentNow, error, notifiedAt: nowIso() };

  db.prepare(
    `INSERT INTO dispatch_notices (batch_id, courier, recipient, sent, failed, error, notified_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (batch_id) DO UPDATE SET recipient = excluded.recipient, sent = excluded.sent, failed = excluded.failed,
       error = excluded.error, notified_at = excluded.notified_at`
  ).run(batchId, courier, recipient, sent, notice.failed, error, notice.notifiedAt);

  console.log(`[mail] dispatch ${courier}: ${sentNow} sent, ${notice.failed} failed${error ? ` (${error})` : ''}`);

  return notice;
}

/** Submitted dispatch handovers from the last two days with cleared parcels not yet emailed. */
function handoversWithPending(): string[] {
  const since = new Date(Date.now() - RETRY_WITHIN_MS).toISOString();

  return db
    .prepare(
      `SELECT DISTINCT b.id FROM receiving_batches b
       JOIN handover_checks hc ON hc.batch_id = b.id AND hc.result = ?
       WHERE b.kind = ? AND b.submitted_at IS NOT NULL AND b.submitted_at >= ?
         AND NOT EXISTS (SELECT 1 FROM dispatch_emails de WHERE de.check_id = hc.id)`
    )
    .all(HandoverResult.CLEAR, BatchKind.DISPATCH, since)
    .map(row => String(row.id));
}

/** Retries emails that didn't go out (mail server down, scans that arrived late). Returns a stop function. */
export function startDispatchEmailRetry(): () => void {
  const timer = setInterval(() => {
    void (async () => {
      for (const batchId of handoversWithPending()) {
        await notifyDispatch(batchId).catch(err => console.error('[mail] dispatch email retry failed:', err));
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
