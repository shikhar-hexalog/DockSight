import type { ReturnDetail } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';

interface Field {
  label: string;
  value: string | null;
  mono?: boolean;
}

function fieldsFor(detail: ReturnDetail): Field[] {
  return [
    { label: 'Uniware account', value: `${detail.account} · ${detail.facilityCode}`, mono: true },
    { label: 'Sale order', value: detail.saleOrderCode, mono: true },
    { label: 'Shipment', value: detail.shipmentCode, mono: true },
    { label: 'Reverse pickup', value: detail.reversePickupCode, mono: true },
    { label: 'Courier', value: detail.rtoCourier ?? detail.courier },
    { label: 'Forward AWB', value: detail.trackingNumber === detail.rtoTrackingNumber ? null : detail.trackingNumber, mono: true },
    { label: 'Return AWB', value: detail.rtoTrackingNumber, mono: true },
    { label: 'RTO reason', value: detail.rtoReason },
    { label: 'Putaway', value: detail.putawayCode, mono: true },
    { label: 'Uniware status', value: detail.sourceStatus, mono: true },
  ].filter(field => field.value);
}

function FieldValue({ field }: { field: Field }) {
  if (field.mono) {
    return <Mono>{field.value}</Mono>;
  }

  return <span className="text-[13px]">{field.value}</span>;
}

export function ReturnIdentifiers({ detail }: { detail: ReturnDetail }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
      {fieldsFor(detail).map(field => (
        <div key={field.label} className="contents">
          <dt className="text-[13px] text-muted-foreground">{field.label}</dt>

          <dd className="min-w-0 truncate text-right">
            <FieldValue field={field} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
