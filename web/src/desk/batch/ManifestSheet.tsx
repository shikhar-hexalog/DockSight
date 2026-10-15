// The printed return manifest: every parcel in it, with the codes staff need
// to scan it into Uniware's Returns -> Manifest screen, and a box to sign.
// Shown only when printing (.print-sheet).

import { createPortal } from 'react-dom';

import type { ManifestParcel, ReturnManifest } from '@hexabuild/shared';

const dateTime = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ManifestSheet({ manifest, parcels }: { manifest: ReturnManifest; parcels: ManifestParcel[] }) {
  const inOrder = [...parcels].reverse();

  return createPortal(
    <div className="print-sheet">
      <h1>Return manifest</h1>

      <p>
        Manifest <b>{manifest.id.slice(0, 8).toUpperCase()}</b> · Printed {dateTime.format(new Date())}
      </p>

      <p>
        Courier: <b>{manifest.courier}</b> · Made by: <b>{manifest.createdBy}</b> · Started {dateTime.format(new Date(manifest.createdAt))} · Parcels:{' '}
        <b>{parcels.length}</b>
      </p>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>AWB</th>
            <th>Return</th>
            <th>Order</th>
            <th>Items</th>
          </tr>
        </thead>

        <tbody>
          {inOrder.map((parcel, index) => (
            <tr key={parcel.returnId}>
              <td>{index + 1}</td>
              <td className="mono">{parcel.code}</td>
              <td className="mono">{parcel.sourceCode}</td>
              <td className="mono">{parcel.saleOrderCode ?? '—'}</td>
              <td>{parcel.itemCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sigs">
        <div className="sig">
          <p className="sig-title">Manifested by</p>
          <p>Name: ____________________________</p>
          <p className="sig-line">Signature</p>
          <p>Date &amp; time: _____________________</p>
        </div>

        <div className="sig">
          <p className="sig-title">Received at QC</p>
          <p>Name: ____________________________</p>
          <p className="sig-line">Signature</p>
          <p>Date &amp; time: _____________________</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
