import { CircleCheck, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router';

import type { ManifestParcel, ReturnManifest } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ManifestSheet } from '@/desk/batch/ManifestSheet';
import { useManifest, useManifests } from '@/hooks/queries';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const MANIFEST_PARAM = 'm';

function useSelectedManifest() {
  const [params, setParams] = useSearchParams();

  return { id: params.get(MANIFEST_PARAM), select: (next: string) => setParams({ [MANIFEST_PARAM]: next }) };
}

function QcProgress({ manifest, parcels }: { manifest: ReturnManifest; parcels: ManifestParcel[] }) {
  const done = parcels.filter(parcel => parcel.qcDone).length;

  return (
    <span>
      {done} of {manifest.count} QC'd
    </span>
  );
}

function ManifestListItem({ manifest, active, onSelect }: { manifest: ReturnManifest; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-0.5 px-2 py-2.5 text-left transition-colors',
        active ? 'bg-muted text-ink' : 'hover:bg-muted/60'
      )}
    >
      <span className={cn('flex items-center gap-2 text-sm', active ? 'font-semibold' : 'font-medium')}>
        {manifest.courier}

        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{manifest.count}</span>
      </span>

      <span className="text-xs text-muted-foreground">
        {manifest.createdBy} · {formatRelative(manifest.closedAt ?? manifest.createdAt)}
      </span>
    </button>
  );
}

function ManifestList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { data } = useManifests();

  const manifests = data?.data ?? [];

  if (manifests.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">None yet. Submit a receiving handover to make one.</p>;
  }

  return (
    <div className="flex flex-col divide-y border-y">
      {manifests.map(manifest => (
        <ManifestListItem key={manifest.id} manifest={manifest} active={manifest.id === selectedId} onSelect={() => onSelect(manifest.id)} />
      ))}
    </div>
  );
}

function QcMark({ parcel }: { parcel: ManifestParcel }) {
  if (!parcel.qcDone) {
    return <span className="text-xs text-muted-foreground">Waiting</span>;
  }

  return (
    <span className="flex items-center gap-1 text-xs text-ok">
      <CircleCheck className="size-3.5" />
      Done
    </span>
  );
}

function ParcelsTable({ parcels }: { parcels: ManifestParcel[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>AWB</TableHead>
          <TableHead>Return</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Received</TableHead>
          <TableHead>QC</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {parcels.map(parcel => (
          <TableRow key={parcel.returnId}>
            <TableCell>
              <Mono>{parcel.code}</Mono>
            </TableCell>

            <TableCell>
              <Mono className="text-muted-foreground">{parcel.sourceCode}</Mono>
            </TableCell>

            <TableCell className="max-w-64 truncate">
              {parcel.firstItemName ?? '—'}
              <span className="text-muted-foreground">{parcel.itemCount > 1 ? ` +${parcel.itemCount - 1}` : ''}</span>
            </TableCell>

            <TableCell className="text-muted-foreground">{formatDateTime(parcel.addedAt)}</TableCell>

            <TableCell>
              <QcMark parcel={parcel} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ManifestView({ id }: { id: string }) {
  const { data, error } = useManifest(id);

  if (error) {
    return <p className="text-sm text-overdue">{error.message}</p>;
  }

  if (!data) {
    return null;
  }

  const { manifest, parcels } = data;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">
            {manifest.courier} <span className="font-normal text-muted-foreground">· {manifest.count} parcels</span>
          </h2>

          <p className="text-xs text-muted-foreground">
            Received by {manifest.createdBy}, handover signed {formatDateTime(manifest.closedAt ?? manifest.createdAt)} ·{' '}
            <Mono>{manifest.id.slice(0, 8).toUpperCase()}</Mono> · <QcProgress manifest={manifest} parcels={parcels} />
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print for Uniware
        </Button>
      </div>

      <ParcelsTable parcels={parcels} />

      <ManifestSheet manifest={manifest} parcels={parcels} />
    </div>
  );
}

function SelectedView({ id }: { id: string | null }) {
  if (!id) {
    return (
      <div className="flex flex-col gap-1 py-6">
        <p className="text-[17px] text-ink">No second scan needed</p>

        <p className="max-w-md text-[13px] text-muted-foreground">
          Each receiving handover becomes its courier's return manifest when the signed sheet is submitted. Pick one to see or print it.
        </p>
      </div>
    );
  }

  return <ManifestView id={id} />;
}

export function ManifestPage() {
  const { id, select } = useSelectedManifest();

  return (
    <>
      <PageHeader title="Manifests" description="Made automatically from each receiving handover, one per courier drop. Next stop: QC." />

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[240px_1fr]">
        <ManifestList selectedId={id} onSelect={select} />

        <SelectedView id={id} />
      </div>
    </>
  );
}
