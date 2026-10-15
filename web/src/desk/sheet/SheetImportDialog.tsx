// Import the warehouse's receiving sheet: pick the file, see exactly what
// it will do (a dry run on the server), then import.

import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { type ChangeEvent, useState } from 'react';
import { toast } from 'sonner';

import { SHEET_OUTCOME_LABEL, SheetOutcome, type SheetImportResponse } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useDesk } from '@/desk/DeskProvider';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import { type ReadSheetResult, readReceivingSheet } from './readReceivingSheet';

const ACCEPT = '.xlsx,.csv';

const MAX_PROBLEMS_SHOWN = 8;

// Outcomes that need someone to look at the parcel.
const ATTENTION: SheetOutcome[] = [SheetOutcome.NOT_FOUND, SheetOutcome.CANCELLED_RETURN];

const OUTCOME_ORDER: SheetOutcome[] = [
  SheetOutcome.RECEIVED,
  SheetOutcome.PROCESSED_TIME_RECORDED,
  SheetOutcome.ALREADY_RECEIVED,
  SheetOutcome.CANCELLED_RETURN,
  SheetOutcome.NOT_FOUND,
  SheetOutcome.DUPLICATE,
];

interface Preview {
  fileName: string;
  sheet: ReadSheetResult;
  result: SheetImportResponse;
}

function OutcomeRow({ outcome, result }: { outcome: SheetOutcome; result: SheetImportResponse }) {
  const count = result.counts[outcome];

  if (count === 0) {
    return null;
  }

  const examples = result.examples[outcome] ?? [];

  return (
    <li className="flex flex-col gap-0.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn('text-sm', ATTENTION.includes(outcome) && 'text-overdue')}>{SHEET_OUTCOME_LABEL[outcome]}</span>

        <span className="font-mono text-sm font-semibold tabular-nums">{formatCount(count)}</span>
      </div>

      <Mono className="truncate text-[11px] text-muted-foreground">{examples.join(' · ')}</Mono>
    </li>
  );
}

function Problems({ sheet }: { sheet: ReadSheetResult }) {
  if (sheet.problems.length === 0) {
    return null;
  }

  return (
    <div className="text-[12.5px]">
      <p className="mb-1 font-medium text-warn">{formatCount(sheet.problems.length)} rows skipped</p>

      <ul className="space-y-0.5">
        {sheet.problems.slice(0, MAX_PROBLEMS_SHOWN).map(problem => (
          <li key={`${problem.line}-${problem.awb}`}>
            Row {problem.line} <Mono className="text-[11px]">{problem.awb}</Mono>: {problem.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DefaultTimeNote({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return <p className="text-xs text-muted-foreground">{formatCount(count)} rows have no time; counted from 10:00 that day.</p>;
}

function PreviewBody({ preview }: { preview: Preview }) {
  const { result, sheet } = preview;

  const title = result.dryRun ? 'If you import this file' : 'Imported';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-medium">{preview.fileName}</span> · {formatCount(result.total)} parcels
      </p>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>

        <ul className="divide-y">
          {OUTCOME_ORDER.map(outcome => (
            <OutcomeRow key={outcome} outcome={outcome} result={result} />
          ))}
        </ul>
      </div>

      <DefaultTimeNote count={sheet.defaultTimeCount} />

      <Problems sheet={sheet} />
    </div>
  );
}

function FilePicker({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = '';

    if (file) {
      onFile(file);
    }
  }

  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed border-input p-6 text-center text-[13.5px] hover:border-ink',
        busy && 'pointer-events-none opacity-60'
      )}
    >
      <FileSpreadsheet className="size-8 text-muted-foreground" />

      <span className="font-medium">Choose the receiving sheet</span>

      <span className="text-xs text-muted-foreground">
        Excel (.xlsx) or CSV with DATE, Received Time, Vehicle No, AWB#, Courier, TYPE, Remarks. From Google Sheets: File → Download → .xlsx
      </span>

      <input type="file" accept={ACCEPT} onChange={onChange} className="sr-only" />
    </label>
  );
}

function DialogBody({ preview, busy, onFile }: { preview: Preview | null; busy: boolean; onFile: (file: File) => void }) {
  if (busy && !preview) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Reading the sheet and matching it with Uniware…
      </div>
    );
  }

  if (!preview) {
    return <FilePicker onFile={onFile} busy={busy} />;
  }

  return <PreviewBody preview={preview} />;
}

function Actions({ preview, busy, onImport, onReset }: { preview: Preview | null; busy: boolean; onImport: () => void; onReset: () => void }) {
  if (!preview) {
    return null;
  }

  if (!preview.result.dryRun) {
    return <Button onClick={onReset}>Import another file</Button>;
  }

  return (
    <>
      <Button variant="ghost" onClick={onReset} disabled={busy}>
        Choose another file
      </Button>

      <Button onClick={onImport} disabled={busy || preview.sheet.rows.length === 0}>
        {busy ? <Spinner className="size-4" /> : null}
        Import {formatCount(preview.sheet.rows.length)} parcels
      </Button>
    </>
  );
}

export function SheetImportButton() {
  const { scanner, syncNow } = useDesk();

  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);

  const importedBy = scanner ? `${scanner} (sheet)` : 'Receiving sheet';

  async function onFile(file: File) {
    setBusy(true);

    try {
      const sheet = await readReceivingSheet(file);

      if (sheet.rows.length === 0) {
        throw new Error('No parcels found in the sheet.');
      }

      const result = await api.importSheet({ rows: sheet.rows, importedBy, dryRun: true });

      setPreview({ fileName: file.name, sheet, result });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!preview) {
      return;
    }

    setBusy(true);

    try {
      const result = await api.importSheet({ rows: preview.sheet.rows, importedBy, dryRun: false });

      setPreview({ ...preview, result });

      toast.success(`Imported ${formatCount(result.total)} parcels from the receiving sheet`);

      void queryClient.invalidateQueries();

      syncNow();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);

    if (!next) {
      setPreview(null);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet />
        Import sheet
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import receiving sheet</DialogTitle>

            <DialogDescription>
              Each row is a parcel that arrived at the dock. Matching AWBs move to Pending in Uniware with the sheet's arrival time. Importing the
              same file again changes nothing.
            </DialogDescription>
          </DialogHeader>

          <DialogBody preview={preview} busy={busy} onFile={file => void onFile(file)} />

          <div className="flex justify-end gap-2">
            <Actions preview={preview} busy={busy} onImport={() => void onImport()} onReset={() => setPreview(null)} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
