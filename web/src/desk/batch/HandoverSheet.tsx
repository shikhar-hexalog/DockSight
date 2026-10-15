// The printed handover sheet: every parcel in the batch with its condition,
// the counts, and boxes for our worker and the courier rider to sign.
// Built from this desk's own records, so it prints even with no network.
// Only shown when printing (see .print-sheet in index.css).

import { createPortal } from 'react-dom';

import { PARCEL_CONDITIONS, PARCEL_CONDITION_LABEL, type BatchStart, SCAN_RESULT_LABEL } from '@hexabuild/shared';

import type { DeskScanEntry } from '@/desk/localDb';

const dateTime = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

function CountLine({ scanned, courierCount }: { scanned: number; courierCount: number | null }) {
  if (courierCount === null) {
    return <p>Parcels scanned: {scanned}</p>;
  }

  const difference = scanned - courierCount;

  const note = difference === 0 ? 'matches' : difference < 0 ? `SHORT BY ${-difference}` : `${difference} EXTRA`;

  return (
    <p>
      Parcels scanned: <b>{scanned}</b> · Rider's count: <b>{courierCount}</b> · <b>{note}</b>
    </p>
  );
}

function ConditionSummary({ entries }: { entries: DeskScanEntry[] }) {
  const counts = PARCEL_CONDITIONS.map(c => ({ c, n: entries.filter(e => e.condition === c).length })).filter(x => x.n > 0);

  if (counts.length === 0) {
    return <p>No parcel marked with a condition issue.</p>;
  }

  return <p>Condition issues: {counts.map(x => `${PARCEL_CONDITION_LABEL[x.c]}: ${x.n}`).join(' · ')}</p>;
}

function SignatureBox({ title }: { title: string }) {
  return (
    <div className="sig">
      <p className="sig-title">{title}</p>

      <p>Name: ____________________________</p>

      <p>Phone: ___________________________</p>

      <p className="sig-line">Signature</p>

      <p>Date &amp; time: _____________________</p>
    </div>
  );
}

interface HandoverSheetProps {
  batch: BatchStart;
  entries: DeskScanEntry[];
  courierCount: number | null;
}

export function HandoverSheet({ batch, entries, courierCount }: HandoverSheetProps) {
  const rows = [...entries].reverse();

  return createPortal(
    <div className="print-sheet">
      <h1>Returns handover sheet</h1>

      <p>
        Batch <b>{batch.id.slice(0, 8).toUpperCase()}</b> · Printed {dateTime.format(new Date())}
      </p>

      <p>
        Delivery partner: <b>{batch.courier}</b> · Vehicle: <b>{batch.vehicleNo ?? '—'}</b> · Received by: <b>{batch.scannedBy}</b> · Started{' '}
        {dateTime.format(new Date(batch.startedAt))}
      </p>

      <CountLine scanned={rows.length} courierCount={courierCount} />

      <ConditionSummary entries={rows} />

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>AWB scanned</th>
            <th>Return</th>
            <th>Item</th>
            <th>Result</th>
            <th>Condition</th>
            <th>Note</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((entry, index) => (
            <tr key={entry.id}>
              <td>{index + 1}</td>
              <td>{time.format(new Date(entry.scannedAt))}</td>
              <td className="mono">{entry.code}</td>
              <td className="mono">{entry.sourceCode ?? '—'}</td>
              <td>{entry.firstItemName ?? '—'}</td>
              <td>{SCAN_RESULT_LABEL[entry.result]}</td>
              <td>{entry.condition ? PARCEL_CONDITION_LABEL[entry.condition] : 'OK'}</td>
              <td>{entry.conditionNote ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="fine">
        Both parties confirm the parcels above were handed over in the condition listed. Parcels without a condition issue were received with the
        outer packaging intact.
      </p>

      <div className="sigs">
        <SignatureBox title="Received by (Hexalog warehouse)" />

        <SignatureBox title={`Handed over by (${batch.courier} rider)`} />
      </div>
    </div>,
    document.body
  );
}
