// The printed courier pickup sheet: every parcel the rider is taking (it
// passed the cancellation check), the ones held back, the counts, and boxes
// for our worker and the rider to sign. Built from this desk's own records,
// so it prints with no network. Shown only when printing (.print-sheet).

import { createPortal } from 'react-dom';

import { type BatchStart, HandoverResult } from '@hexabuild/shared';

import type { HandoverEntry } from '@/desk/useHandoverCheck';

const dateTime = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

function CountLine({ cleared, courierCount }: { cleared: number; courierCount: number | null }) {
  if (courierCount === null) {
    return <p>Parcels handed over: {cleared}</p>;
  }

  const difference = cleared - courierCount;

  const note = difference === 0 ? 'matches' : difference < 0 ? `RIDER COUNTS ${-difference} MORE` : `RIDER COUNTS ${difference} FEWER`;

  return (
    <p>
      Parcels handed over: <b>{cleared}</b> · Rider's count: <b>{courierCount}</b> · <b>{note}</b>
    </p>
  );
}

function HeldBack({ entries }: { entries: HandoverEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <>
      <h2>Held back: order cancelled, not handed over ({entries.length})</h2>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>AWB scanned</th>
            <th>Order</th>
            <th>Manifest</th>
          </tr>
        </thead>

        <tbody>
          {entries.map((entry, index) => (
            <tr key={entry.check.id}>
              <td>{index + 1}</td>
              <td className="mono">{entry.check.code}</td>
              <td className="mono">{entry.hold?.saleOrderCode ?? '—'}</td>
              <td className="mono">{entry.hold?.manifestCode ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface DispatchSheetProps {
  batch: BatchStart;
  entries: HandoverEntry[];
  courierCount: number | null;
}

export function DispatchSheet({ batch, entries, courierCount }: DispatchSheetProps) {
  const inOrder = [...entries].reverse();

  const cleared = inOrder.filter(entry => entry.result === HandoverResult.CLEAR);

  const heldBack = inOrder.filter(entry => entry.result === HandoverResult.STOP || entry.result === HandoverResult.ALREADY_PULLED);

  return createPortal(
    <div className="print-sheet">
      <h1>Courier pickup sheet</h1>

      <p>
        Batch <b>{batch.id.slice(0, 8).toUpperCase()}</b> · Printed {dateTime.format(new Date())}
      </p>

      <p>
        Courier partner: <b>{batch.courier}</b> · Vehicle: <b>{batch.vehicleNo ?? '—'}</b> · Handed over by: <b>{batch.scannedBy}</b> · Started{' '}
        {dateTime.format(new Date(batch.startedAt))}
      </p>

      <CountLine cleared={cleared.length} courierCount={courierCount} />

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>AWB</th>
          </tr>
        </thead>

        <tbody>
          {cleared.map((entry, index) => (
            <tr key={entry.check.id}>
              <td>{index + 1}</td>
              <td>{time.format(new Date(entry.check.checkedAt))}</td>
              <td className="mono">{entry.check.code}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <HeldBack entries={heldBack} />

      <p className="fine">
        The courier rider confirms receiving the parcels listed under "handed over" in good outer condition. Parcels held back were not handed over.
      </p>

      <div className="sigs">
        <div className="sig">
          <p className="sig-title">Handed over by (Hexalog warehouse)</p>
          <p>Name: ____________________________</p>
          <p className="sig-line">Signature</p>
          <p>Date &amp; time: _____________________</p>
        </div>

        <div className="sig">
          <p className="sig-title">Received by ({batch.courier} rider)</p>
          <p>Name: ____________________________</p>
          <p>Phone: ___________________________</p>
          <p className="sig-line">Signature</p>
          <p>Date &amp; time: _____________________</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
