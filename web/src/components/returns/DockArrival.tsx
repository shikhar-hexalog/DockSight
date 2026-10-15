// How the parcel arrived at our dock: who received it from which delivery
// partner, its condition, the photo, and the signed handover sheet. The part
// CX needs when a customer or courier disputes a return.

import { type DockArrival as Arrival, PARCEL_CONDITION_LABEL } from '@hexabuild/shared';

import { formatDateTime } from '@/lib/format';

function Condition({ arrival }: { arrival: Arrival }) {
  if (!arrival.condition) {
    return <p className="text-[13.5px]">Condition: no issue noted at the dock</p>;
  }

  const note = arrival.conditionNote ? ` · "${arrival.conditionNote}"` : '';

  return (
    <p className="text-[13.5px] font-medium text-overdue">
      {PARCEL_CONDITION_LABEL[arrival.condition]}
      <span className="font-normal text-muted-foreground">{note}</span>
    </p>
  );
}

function FileLink({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return null;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-[13px] text-brand underline underline-offset-[3px] hover:text-ink">
      {label}
    </a>
  );
}

function SheetStatus({ arrival }: { arrival: Arrival }) {
  if (arrival.signedSheetUrl || !arrival.batchId) {
    return null;
  }

  return <span className="text-xs text-warn">Handover sheet not signed yet</span>;
}

export function DockArrival({ arrival }: { arrival: Arrival | null }) {
  if (!arrival) {
    return <p className="pt-2.5 text-[13.5px] text-muted-foreground">Not received at our dock yet.</p>;
  }

  const from = arrival.courier ? ` from ${arrival.courier}` : '';

  const vehicle = arrival.vehicleNo ? ` (${arrival.vehicleNo})` : '';

  return (
    <div className="flex flex-col gap-2 pt-2.5">
      <p className="text-[13.5px]">
        Received{from}
        {vehicle} by {arrival.scannedBy}, {formatDateTime(arrival.scannedAt)}
      </p>

      <Condition arrival={arrival} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <FileLink url={arrival.conditionPhotoUrl} label="Parcel photo" />

        <FileLink url={arrival.signedSheetUrl} label="Signed handover sheet" />

        <SheetStatus arrival={arrival} />
      </div>
    </div>
  );
}
