import { CloudOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BatchKind, EXCEPTION_RESULTS, RemoteTarget, ScanResult } from '@hexabuild/shared';

import { PageHeader } from '@/components/layout/PageHeader';
import { Spinner } from '@/components/ui/spinner';
import { Connection, useDesk } from '@/desk/DeskProvider';
import { BatchBar } from '@/desk/batch/BatchBar';
import { HandoverSheet } from '@/desk/batch/HandoverSheet';
import { ConditionPanel } from '@/desk/batch/ConditionPanel';
import { StartBatchForm } from '@/desk/batch/StartBatchForm';
import { LabelReaderDialog } from '@/desk/components/LabelReaderDialog';
import { LastScanCard } from '@/desk/components/LastScanCard';
import { OperatorGate } from '@/desk/components/OperatorGate';
import { ScanInput } from '@/desk/components/ScanInput';
import { ScanLog } from '@/desk/components/ScanLog';
import type { DeskScanEntry } from '@/desk/localDb';
import { PhoneScannerButton } from '@/desk/phone/PhoneScannerButton';
import { SheetImportButton } from '@/desk/sheet/SheetImportDialog';
import { type PhoneLink, usePhoneLink } from '@/desk/phone/usePhoneLink';
import { SCAN_SOUND, playSound } from '@/desk/sounds';
import { useNotifiedToast } from '@/desk/useNotifiedToast';
import { type ExportFile, ExportMenu } from '@/components/common/ExportMenu';
import { exportUrls } from '@/lib/api';
import { formatCount, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const RECEIVE_EXPORTS: ExportFile[] = [{ label: 'Received scans', url: range => exportUrls.scans(range.since, range.until) }];

function DeskConnection() {
  const { connection, pendingCount, lastSyncedAt, syncNow } = useDesk();

  if (connection === Connection.OFFLINE) {
    return (
      <button
        type="button"
        onClick={syncNow}
        className="flex items-center gap-1.5 rounded-full border border-warn/50 bg-warn/10 px-3 py-1 text-xs font-medium"
      >
        <CloudOff className="size-3.5" />
        Offline · {formatCount(pendingCount)} scans saved here, will sync
      </button>
    );
  }

  if (connection === Connection.SYNCING || pendingCount > 0) {
    return (
      <span className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Syncing {formatCount(pendingCount)}
      </span>
    );
  }

  return (
    <button type="button" onClick={syncNow} className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
      <RefreshCw className="size-3" />
      Expected list updated {formatRelative(lastSyncedAt)}
    </button>
  );
}

interface Counter {
  label: string;
  value: number;
  alert?: boolean;
}

function countersFor(entries: DeskScanEntry[]): Counter[] {
  const count = (results: ScanResult[]) => entries.filter(e => results.includes(e.result)).length;

  return [
    { label: 'Received', value: count([ScanResult.MATCHED]) },
    { label: 'Set aside', value: count(EXCEPTION_RESULTS), alert: count(EXCEPTION_RESULTS) > 0 },
    { label: 'In this handover', value: entries.length },
  ];
}

/** This handover's tally, small enough to sit in the batch bar. */
function HandoverCounts({ entries }: { entries: DeskScanEntry[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {countersFor(entries)
        .filter(counter => counter.label !== 'In this handover')
        .map(counter => (
          <span key={counter.label} className="flex items-baseline gap-1 rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground">
            <span className={cn('font-mono text-sm font-semibold text-foreground tabular-nums', counter.alert && 'text-overdue')}>
              {formatCount(counter.value)}
            </span>
            {counter.label.toLowerCase()}
          </span>
        ))}
    </div>
  );
}

function DeskWorkspace({ onScan }: { onScan: (code: string) => Promise<ScanResult | null> }) {
  const { batch, batchEntries, ready, removeScan } = useDesk();

  const [readingLabel, setReadingLabel] = useState(false);

  // The parcel being tagged: the latest scan unless a row was picked.
  const [pickedId, setPickedId] = useState<string | null>(null);

  // The latest scan of any kind gets its feedback card; only parcels truly received make the list.
  const latest = batchEntries[0];

  const received = batchEntries.filter(e => e.result === ScanResult.MATCHED);

  const picked = received.find(e => e.id === pickedId);

  const tagging = picked ?? latest;

  // A new scan goes back to tagging the latest parcel.
  useEffect(() => setPickedId(null), [latest?.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b px-6 py-4">
        <BatchBar
          kind={BatchKind.RECEIVE}
          batch={batch!}
          count={received.length}
          renderSheet={courierCount => <HandoverSheet batch={batch!} entries={received} courierCount={courierCount} />}
          extra={
            <>
              <HandoverCounts entries={batchEntries} />

              <DeskConnection />
            </>
          }
        />

        <ScanInput disabled={!ready} onScan={code => void onScan(code)} />

        <button
          type="button"
          onClick={() => setReadingLabel(true)}
          className="-mt-2 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Label won't scan? Read it from a photo
        </button>

        <LabelReaderDialog
          open={readingLabel}
          onClose={() => setReadingLabel(false)}
          onCode={code => {
            setReadingLabel(false);
            void onScan(code);
          }}
        />

        <div className="flex flex-col gap-2">
          <LastScanCard entry={latest} />

          <ConditionPanel entry={tagging} isLatest={!picked || picked.id === latest?.id} onBackToLatest={() => setPickedId(null)} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <ScanLog entries={received} selectedId={tagging?.id ?? null} onSelect={setPickedId} onRemove={removeScan} />
      </div>
    </div>
  );
}

function DeskBody({ onScan }: { onScan: (code: string) => Promise<ScanResult | null> }) {
  const { batch } = useDesk();

  if (!batch) {
    return (
      <div className="p-6">
        <StartBatchForm kind={BatchKind.RECEIVE} />
      </div>
    );
  }

  return <DeskWorkspace onScan={onScan} />;
}

/** One scan, from the barcode gun or the phone: classify, store, beep. */
function useReceiveScan() {
  const { scan } = useDesk();

  return async (code: string): Promise<ScanResult | null> => {
    const entry = await scan(code);

    if (!entry) {
      return null;
    }

    playSound(SCAN_SOUND[entry.result]);

    return entry.result;
  };
}

function PhoneButton({ link }: { link: PhoneLink }) {
  const { batch } = useDesk();

  if (!batch) {
    return null;
  }

  return <PhoneScannerButton link={link} />;
}

export function ReceivePage() {
  const onScan = useReceiveScan();

  useNotifiedToast('RECEIVE');

  const link = usePhoneLink(RemoteTarget.RECEIVE, ({ id, code }) => {
    void onScan(code).then(result => {
      if (result) {
        link.report(id, code, result);
      }
    });
  });

  return (
    <>
      <PageHeader
        title="Receive returns"
        description="Scan each parcel's AWB as it's unloaded. Replaces the Google Sheet."
        actions={
          <>
            <PhoneButton link={link} />

            <SheetImportButton />

            <ExportMenu files={RECEIVE_EXPORTS} />
          </>
        }
      />

      <DeskBody onScan={onScan} />

      <OperatorGate question="Who is receiving?" action="Start receiving" />
    </>
  );
}
