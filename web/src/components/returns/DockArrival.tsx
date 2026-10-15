// How the parcel arrived at our dock: who received it from which delivery
// partner, its condition, the photo, and the signed handover sheet. The part
// CX needs when a customer or courier disputes a return.

import { Camera, FileCheck2 } from 'lucide-react';

import { type DockArrival as Arrival, PARCEL_CONDITION_LABEL } from '@hexabuild/shared';

import { formatDateTime } from '@/lib/format';

function Condition({ arrival }: { arrival: Arrival }) {
  if (!arrival.condition) {
    return <p className="text-sm">Condition: no issue noted at the dock</p>;
  }

  const note = arrival.conditionNote ? ` · "${arrival.conditionNote}"` : '';

  return (
    <p className="text-sm font-medium text-overdue">
      {PARCEL_CONDITION_LABEL[arrival.condition]}
      <span className="font-normal text-muted-foreground">{note}</span>
    </p>
  );
}

function FileLink({ url, label, icon }: { url: string | null; label: string; icon: React.ReactNode }) {
  if (!url) {
    return null;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted">
      {icon}
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
    return <p className="text-sm text-muted-foreground">Not received at our dock yet.</p>;
  }

  const from = arrival.courier ? ` from ${arrival.courier}` : '';

  const vehicle = arrival.vehicleNo ? ` (${arrival.vehicleNo})` : '';

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Received{from}
        {vehicle} by {arrival.scannedBy}, {formatDateTime(arrival.scannedAt)}
      </p>

      <Condition arrival={arrival} />

      <div className="flex flex-wrap items-center gap-2">
        <FileLink url={arrival.conditionPhotoUrl} label="Parcel photo" icon={<Camera className="size-3.5" />} />

        <FileLink url={arrival.signedSheetUrl} label="Signed handover sheet" icon={<FileCheck2 className="size-3.5" />} />

        <SheetStatus arrival={arrival} />
      </div>
    </div>
  );
}
