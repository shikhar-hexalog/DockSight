import { useState } from 'react';
import { toast } from 'sonner';

import { type Receipt, SCAN_RESULT_LABEL } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { TextToggle } from '@/components/common/TextToggle';
import { QueryError } from '@/components/common/QueryError';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useDesk } from '@/desk/DeskProvider';
import { RESULT_STYLE } from '@/desk/scanResultStyle';
import { useReceipts, useResolveReceipt } from '@/hooks/queries';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const View = {
  OPEN: 'open',
  ALL: 'all',
} as const;

type View = (typeof View)[keyof typeof View];

const COLUMNS = ['Scanned', 'Code', 'Problem', 'Return', 'Order', 'Reverse pickup', 'Scanned by', 'Status', ''];

function ResolveDialog({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const { scanner } = useDesk();

  const resolve = useResolveReceipt();

  const [note, setNote] = useState('');

  const [by, setBy] = useState(scanner ?? '');

  function submit() {
    if (!receipt) {
      return;
    }

    resolve.mutate(
      { id: receipt.id, resolvedBy: by.trim(), note: note.trim() },
      {
        onSuccess: () => {
          toast.success('Marked as resolved');
          setNote('');
          onClose();
        },
        onError: error => toast.error(error.message),
      }
    );
  }

  return (
    <Dialog open={receipt !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve {receipt?.code}</DialogTitle>

          <DialogDescription>Write what was done, e.g. "Reverse pickup recreated" or "Sent back to courier".</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="resolution">What was done</Label>

            <Textarea id="resolution" value={note} onChange={e => setNote(e.target.value)} className="min-h-20" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="resolved-by">Your name</Label>

            <Input id="resolved-by" value={by} onChange={e => setBy(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!note.trim() || !by.trim() || resolve.isPending}>
            Mark resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusCell({ receipt, onResolve }: { receipt: Receipt; onResolve: (receipt: Receipt) => void }) {
  if (receipt.resolvedAt) {
    return (
      <span className="text-[12.5px] text-muted-foreground">
        Resolved by {receipt.resolvedBy}: {receipt.resolutionNote}
      </span>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => onResolve(receipt)}>
      Resolve
    </Button>
  );
}

function ExceptionRow({ receipt, onResolve }: { receipt: Receipt; onResolve: (receipt: Receipt) => void }) {
  const style = RESULT_STYLE[receipt.result];

  return (
    <TableRow className="text-[13.5px]">
      <TableCell className="pl-0 whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(receipt.scannedAt)}</TableCell>

      <TableCell>
        <Mono className="text-[12.5px] text-ink">{receipt.code}</Mono>
      </TableCell>

      <TableCell className={cn('font-medium', style.text)}>{SCAN_RESULT_LABEL[receipt.result]}</TableCell>

      <TableCell>
        <Mono className="text-muted-foreground">{receipt.sourceCode ?? '—'}</Mono>
      </TableCell>

      <TableCell>
        <Mono className="text-muted-foreground select-all">{receipt.saleOrderCode ?? '—'}</Mono>
      </TableCell>

      <TableCell>
        <Mono className="text-muted-foreground select-all">{receipt.reversePickupCode ?? '—'}</Mono>
      </TableCell>

      <TableCell className="text-muted-foreground">{receipt.scannedBy}</TableCell>

      <TableCell className="max-w-[260px]">
        <StatusCell receipt={receipt} onResolve={onResolve} />
      </TableCell>

      <TableCell />
    </TableRow>
  );
}

function ExceptionsTable({ view }: { view: View }) {
  const { data, error, isPending, refetch } = useReceipts({ exceptions: true, open: view === View.OPEN || undefined, limit: 500 });

  const [resolving, setResolving] = useState<Receipt | null>(null);

  if (isPending) {
    return <Skeleton className="mx-8 mt-4 h-64" />;
  }

  if (error) {
    return (
      <div className="px-8 py-4">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (data.data.length === 0) {
    return <p className="px-8 py-4 text-[13.5px] text-muted-foreground">No parcels set aside. Every scan matched an expected return.</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-2 pb-6">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background [&_tr]:border-ink">
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map(column => (
              <TableHead key={column} className="h-9 text-[12.5px] font-normal text-muted-foreground first:pl-0">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.data.map(receipt => (
            <ExceptionRow key={receipt.id} receipt={receipt} onResolve={setResolving} />
          ))}
        </TableBody>
      </Table>

      <ResolveDialog receipt={resolving} onClose={() => setResolving(null)} />
    </div>
  );
}

export function ExceptionsPage() {
  const [view, setView] = useState<View>(View.OPEN);

  return (
    <>
      <PageHeader
        title="Set aside"
        description="Parcels that didn't match an expected return, or whose return was cancelled. Each needs someone to act."
        actions={
          <TextToggle
            label="Show"
            options={[
              { value: View.OPEN, label: 'Open' },
              { value: View.ALL, label: 'All' },
            ]}
            value={view}
            onChange={setView}
          />
        }
      />

      <ExceptionsTable view={view} />
    </>
  );
}
