// Every handover starts here: who is scanning, which delivery partner brought
// the load, and the vehicle. Asked for each batch, since each is a new handover.

import { type FormEvent, useState } from 'react';

import { BatchKind } from '@hexabuild/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDesk } from '@/desk/DeskProvider';

const COURIER_LIST_ID = 'desk-couriers';

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13.5px]">
        {label}
        <span className="font-normal text-muted-foreground">{hint}</span>
      </Label>

      {children}
    </div>
  );
}

const COPY: Record<BatchKind, { title: string; description: string; partner: string }> = {
  [BatchKind.RECEIVE]: {
    title: 'Start receiving a handover',
    description: "One batch per delivery partner drop. You'll print a sheet for both sides to sign at the end.",
    partner: 'Delivery partner',
  },
  [BatchKind.DISPATCH]: {
    title: 'Start a courier pickup',
    description: "One batch per courier pickup. Scan each parcel as it's handed over; you'll print a sheet for the rider to sign at the end.",
    partner: 'Courier partner',
  },
};

export function StartBatchForm({ kind }: { kind: BatchKind }) {
  const { scanner, couriers, startBatch } = useDesk();

  const copy = COPY[kind];

  const [name, setName] = useState(scanner ?? '');

  const [courier, setCourier] = useState('');

  const [vehicle, setVehicle] = useState('');

  const ready = name.trim() !== '' && courier.trim() !== '';

  function submit(event: FormEvent) {
    event.preventDefault();

    if (ready) {
      void startBatch({ batchKind: kind, scannedBy: name.trim(), courier: courier.trim(), vehicleNo: vehicle.trim().toUpperCase() || null });
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-5">
      <div className="border-b border-ink pb-3">
        <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">{copy.title}</h2>

        <p className="mt-1 text-[13.5px] text-muted-foreground">{copy.description}</p>
      </div>

      <Field id="batch-name" label="Who is scanning?">
        <Input id="batch-name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoFocus={!scanner} className="h-10" />
      </Field>

      <Field id="batch-courier" label={copy.partner}>
        <Input
          id="batch-courier"
          value={courier}
          onChange={e => setCourier(e.target.value)}
          list={COURIER_LIST_ID}
          placeholder="e.g. Delhivery"
          autoFocus={Boolean(scanner)}
          className="h-10"
        />

        <datalist id={COURIER_LIST_ID}>
          {couriers.map(c => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <Field id="batch-vehicle" label="Vehicle number" hint=" (optional)">
        <Input
          id="batch-vehicle"
          value={vehicle}
          onChange={e => setVehicle(e.target.value)}
          placeholder="e.g. HR55AB1234"
          className="h-10 uppercase placeholder:normal-case"
        />
      </Field>

      <Button type="submit" className="h-10" disabled={!ready}>
        Start scanning
      </Button>
    </form>
  );
}
