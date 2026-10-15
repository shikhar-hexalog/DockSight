// "Your order has been dispatched" emails, sent once when a dispatch handover
// is submitted: one per parcel that cleared the handover check.
//
// Demo: Uniware masks customer emails, so every email goes to MAIL_DEMO_TO
// instead, through Mailpit unless SMTP_* says otherwise.

import { BatchKind, type DispatchNotice, HandoverResult } from '@hexabuild/shared';
import nodemailer from 'nodemailer';

import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { nowIso } from '../lib/time.ts';

const SEND_TIMEOUT_MS = 15_000;

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

/** Sends the emails for a submitted dispatch handover, once. Receiving handovers are ignored. */
export async function notifyDispatch(batchId: string): Promise<DispatchNotice | null> {
  const done = db.prepare('SELECT * FROM dispatch_notices WHERE batch_id = ?').get(batchId);

  if (done) {
    return toNotice(done);
  }

  const batch = db.prepare('SELECT kind, courier, vehicle_no, submitted_at, status FROM receiving_batches WHERE id = ?').get(batchId);

  if (!batch || batch.kind !== BatchKind.DISPATCH || !batch.submitted_at) {
    return null;
  }

  const parcels = db
    .prepare('SELECT code, checked_at AS checkedAt FROM handover_checks WHERE batch_id = ? AND result = ? ORDER BY checked_at')
    .all(batchId, HandoverResult.CLEAR) as unknown as Parcel[];

  const courier = String(batch.courier);

  const vehicleNo = batch.vehicle_no === null ? null : String(batch.vehicle_no);

  const recipient = config.mail.demoTo ?? null;

  let sent = 0;

  let error: string | null = recipient ? null : 'MAIL_DEMO_TO is not set in .env';

  if (recipient) {
    for (const parcel of parcels) {
      try {
        await transport.sendMail({ from: `Hexalog Warehouse <${config.mail.from}>`, to: recipient, ...emailFor(parcel, courier, vehicleNo, String(batch.submitted_at)) });

        sent++;
      } catch (err) {
        error ??= (err as Error).message.slice(0, 200);
      }
    }
  }

  const notice: DispatchNotice = { batchId, courier, recipient, sent, failed: parcels.length - sent, error, notifiedAt: nowIso() };

  db.prepare(
    `INSERT OR IGNORE INTO dispatch_notices (batch_id, courier, recipient, sent, failed, error, notified_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(batchId, courier, recipient, sent, notice.failed, error, notice.notifiedAt);

  console.log(`[mail] dispatch ${courier}: ${sent} sent, ${notice.failed} failed${error ? ` (${error})` : ''}`);

  return notice;
}

export function listDispatchNotices(since: string): DispatchNotice[] {
  return db
    .prepare('SELECT * FROM dispatch_notices WHERE notified_at >= ? ORDER BY notified_at DESC')
    .all(since)
    .map(row => toNotice(row as Record<string, unknown>));
}
