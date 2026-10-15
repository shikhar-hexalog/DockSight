import { ArrowRight, CircleCheck, CircleX, ImageOff, PackageSearch, RotateCw, Sparkles, TriangleAlert } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  type ItemMatch,
  MATCH_VERDICT_LABEL,
  MatchVerdict,
  OutcomeTone,
  QC_GRADE_LABEL,
  QC_REASONS,
  QC_REASON_LABEL,
  QcGrade,
  type QcItemInput,
  type QcLookupResponse,
  type QcMatchCheck,
  QcReason,
  type QcRecord,
  type QcReturn,
  REMOTE_OUTCOME,
  RemoteTarget,
  type ReturnItem,
  type UniwareQcPayload,
  shelfFor,
} from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDesk } from '@/desk/DeskProvider';
import { PhotoPicker } from '@/desk/batch/PhotoPicker';
import { ScanInput } from '@/desk/components/ScanInput';
import { PhoneScannerButton } from '@/desk/phone/PhoneScannerButton';
import { usePhoneLink } from '@/desk/phone/usePhoneLink';
import { TONE_SOUND, playSound } from '@/desk/sounds';
import { useQcCheck, useQcLookup, useQcRecent, useSubmitQc } from '@/hooks/queries';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

type Grade = { grade: QcGrade; reason: QcReason | null };

type Grades = Record<string, Grade>;

/** Where this parcel is in QC: AI product check first, then the person's condition check. */
const Step = {
  PHOTO: 'PHOTO',
  CHECKING: 'CHECKING',
  /** A different product came back: it counts down, then goes to bad inventory. */
  MISMATCH: 'MISMATCH',
  /** Condition check by hand (after a match, an unsure answer, or a skip). */
  MANUAL: 'MANUAL',
} as const;

type Step = (typeof Step)[keyof typeof Step];

const GRADES = [QcGrade.GOOD, QcGrade.BAD];

/** Seconds a wrong product is shown before it moves to bad inventory. */
const MISMATCH_SECONDS = 8;

const GOOD: Grade = { grade: QcGrade.GOOD, reason: null };

const WRONG_ITEM: Grade = { grade: QcGrade.BAD, reason: QcReason.WRONG_ITEM };

const GRADE_ON: Record<QcGrade, string> = {
  [QcGrade.GOOD]: 'border-ok bg-ok text-white',
  [QcGrade.BAD]: 'border-overdue bg-overdue text-white',
};

const GRADE_TEXT: Record<QcGrade, string> = {
  [QcGrade.GOOD]: 'text-ok',
  [QcGrade.BAD]: 'text-overdue',
};

const VERDICT_CARD: Record<MatchVerdict, string> = {
  [MatchVerdict.MATCH]: 'border-ok/40 bg-ok/10',
  [MatchVerdict.MISMATCH]: 'border-overdue/50 bg-overdue/10',
  [MatchVerdict.UNSURE]: 'border-warn/50 bg-warn/10',
};

const VERDICT_TEXT: Record<MatchVerdict, string> = {
  [MatchVerdict.MATCH]: 'text-ok',
  [MatchVerdict.MISMATCH]: 'text-overdue',
  [MatchVerdict.UNSURE]: 'text-warn',
};

const VERDICT_NEXT: Record<MatchVerdict, string> = {
  [MatchVerdict.MATCH]: 'Right product. Now check its condition.',
  [MatchVerdict.MISMATCH]: 'This is not what was sold. No need to check further.',
  [MatchVerdict.UNSURE]: "Couldn't tell from the photo. Check it by hand.",
};

function gradesFor(items: ReturnItem[], locked: Set<string>): Grades {
  return Object.fromEntries(items.map(item => [item.saleOrderItemCode, locked.has(item.saleOrderItemCode) ? WRONG_ITEM : GOOD]));
}

function toInputs(grades: Grades): QcItemInput[] {
  return Object.entries(grades).map(([code, value]) => ({ code, ...value }));
}

/** The same body the server stores: what Uniware's returns/complete would get. */
function previewPayload(target: QcReturn, grades: Grades, shelfCode: string): UniwareQcPayload {
  return {
    saleOrderCode: target.saleOrderCode ?? '',
    saleOrderItems: toInputs(grades).map(item => ({
      code: item.code,
      status: item.grade,
      shelfCode: shelfFor(shelfCode, item.grade),
      ...(item.reason ? { reason: item.reason } : {}),
    })),
  };
}

const missingReason = (grades: Grades) => Object.values(grades).some(value => value.grade === QcGrade.BAD && value.reason === null);

const mismatchedCodes = (check: QcMatchCheck) => new Set(check.items.filter(item => item.verdict === MatchVerdict.MISMATCH).map(item => item.code));

// ------------------------------------------------------------------ facts

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>

      <span className="text-sm">{children}</span>
    </div>
  );
}

function ManifestFact({ target }: { target: QcReturn }) {
  if (!target.manifest) {
    return <span className="text-warn">Not in a manifest yet</span>;
  }

  return <span>{target.manifest.courier}</span>;
}

function ReturnFacts({ target }: { target: QcReturn }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl border bg-muted/30 px-5 py-3">
      <Fact label="Return">
        <Mono>{target.sourceCode}</Mono>
      </Fact>

      <Fact label="Order">
        <Mono>{target.saleOrderCode ?? '—'}</Mono>
      </Fact>

      <Fact label="Type">{target.type}</Fact>

      <Fact label="Courier">{target.courier ?? '—'}</Fact>

      <Fact label="Received at dock">{target.dockReceivedAt ? formatDateTime(target.dockReceivedAt) : 'Not yet'}</Fact>

      <Fact label="Manifest">
        <ManifestFact target={target} />
      </Fact>
    </div>
  );
}

function ItemImage({ url, size = 'size-14' }: { url: string | null; size?: string }) {
  if (!url) {
    return (
      <div className={cn('grid shrink-0 place-items-center rounded-md border bg-muted', size)}>
        <ImageOff className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return <img src={url} alt="" className={cn('shrink-0 rounded-md border object-cover', size)} />;
}

// --------------------------------------------------------- step 1: the AI

function ExpectedStrip({ items }: { items: ReturnItem[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map(item => (
        <div key={item.id} className="flex w-28 flex-col gap-1">
          <ItemImage url={item.catalogImageUrl} size="size-28" />

          <span className="line-clamp-2 text-[11px] text-muted-foreground">{item.itemName}</span>
        </div>
      ))}
    </div>
  );
}

/** Who is doing QC: always shown above the scan box, asked when nobody is set. */
function QcOperator() {
  const { scanner, setScanner } = useDesk();

  const [editing, setEditing] = useState(false);

  const [name, setName] = useState(scanner ?? '');

  if (scanner && !editing) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">QC by</span>

        <span className="font-semibold">{scanner}</span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setName(scanner);

            setEditing(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();

    if (name.trim()) {
      setScanner(name.trim());

      setEditing(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold">Who is doing QC?</span>

      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoFocus className="h-9 w-56" />

      <Button type="submit" size="sm" disabled={!name.trim()}>
        {scanner ? 'Save' : 'Start QC'}
      </Button>

      {scanner && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      )}
    </form>
  );
}

function PhotoStep({ target, onPhoto, onSkip }: { target: QcReturn; onPhoto: (photo: string) => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-dashed border-stage-expected/40 p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-stage-expected" />

        <div className="min-w-0 flex-1">
          <p className="font-semibold">Step 1 · Smart product check</p>

          <p className="text-sm text-muted-foreground">
            Open the parcel and take one photo of what's inside (not the shipping label). It's compared with what was sold: product, colour, print.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <ExpectedStrip items={target.items} />

        <div className="flex flex-col items-end gap-2">
          <PhotoPicker onPhoto={onPhoto} cameraTitle="Photo of what's inside" size="default" />

          <button type="button" onClick={onSkip} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Skip, check by hand
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckingStep({ photo, target }: { photo: string; target: QcReturn }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-stage-expected/40 bg-stage-expected/5 p-5">
      <p className="flex items-center gap-2 font-semibold">
        <Spinner className="size-5" />
        Comparing with the catalogue…
      </p>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-28 flex-col gap-1">
          <ItemImage url={photo} size="size-28" />

          <span className="text-[11px] text-muted-foreground">What came back</span>
        </div>

        <div className="flex h-28 items-center">
          <ArrowRight className="size-5 text-muted-foreground" />
        </div>

        <ExpectedStrip items={target.items} />
      </div>
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: MatchVerdict }) {
  if (verdict === MatchVerdict.MATCH) {
    return <CircleCheck className="size-6 shrink-0" />;
  }

  if (verdict === MatchVerdict.MISMATCH) {
    return <CircleX className="size-6 shrink-0" />;
  }

  return <TriangleAlert className="size-6 shrink-0" />;
}

function CompareRow({ match, item, photo }: { match: ItemMatch; item: ReturnItem | undefined; photo: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-background/70 p-2">
      <ItemImage url={item?.catalogImageUrl ?? null} size="size-16" />

      <ItemImage url={photo} size="size-16" />

      <div className="min-w-0 flex-1 text-sm">
        <p>
          <span className="text-muted-foreground">Sold: </span>
          {match.expected}
        </p>

        <p>
          <span className="text-muted-foreground">Came back: </span>
          {match.observed}
        </p>
      </div>

      <span className={cn('shrink-0 text-xs font-semibold', VERDICT_TEXT[match.verdict])}>{MATCH_VERDICT_LABEL[match.verdict]}</span>
    </div>
  );
}

function VerdictCard({ check, target, photo, children }: { check: QcMatchCheck; target: QcReturn; photo: string | null; children?: ReactNode }) {
  const byCode = new Map(target.items.map(item => [item.saleOrderItemCode, item]));

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border-2 p-4', VERDICT_CARD[check.verdict])}>
      <div className={cn('flex items-center gap-3', VERDICT_TEXT[check.verdict])}>
        <VerdictIcon verdict={check.verdict} />

        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{MATCH_VERDICT_LABEL[check.verdict]}</p>

          <p className="text-sm text-foreground">{VERDICT_NEXT[check.verdict]}</p>
        </div>

        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{check.seconds}s</span>
      </div>

      {check.items.map(match => (
        <CompareRow key={match.code} match={match} item={byCode.get(match.code)} photo={photo} />
      ))}

      <p className="text-xs text-muted-foreground">{check.note}</p>

      {children}
    </div>
  );
}

function MismatchStep({ check, target, photo, onDone }: { check: QcMatchCheck; target: QcReturn; photo: string | null; onDone: () => void }) {
  const [left, setLeft] = useState(MISMATCH_SECONDS);

  useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }

    const timer = setTimeout(() => setLeft(left - 1), 1000);

    return () => clearTimeout(timer);
  }, [left, onDone]);

  return (
    <VerdictCard check={check} target={target} photo={photo}>
      <div className="flex items-center gap-3">
        <span className="font-mono text-2xl font-semibold tabular-nums text-overdue">{left}s</span>

        <p className="text-sm font-medium">Moving to bad inventory</p>
      </div>
    </VerdictCard>
  );
}

function AiSummary({ check, target, photo }: { check: QcMatchCheck | null; target: QcReturn; photo: string | null }) {
  if (!check) {
    return null;
  }

  return <VerdictCard check={check} target={target} photo={photo} />;
}

function AiNote({ note, onRetry }: { note: string | null; onRetry: (() => void) | null }) {
  if (!note) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/50 bg-warn/10 px-4 py-2 text-sm">
      <p className="flex-1">
        {note} {onRetry ? 'Try again, or check it by hand.' : 'Check it by hand.'}
      </p>

      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          Try again
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------- step 2: condition by hand

function GradeButtons({ value, onChange }: { value: QcGrade; onChange: (grade: QcGrade) => void }) {
  return (
    <div className="flex gap-1.5">
      {GRADES.map(grade => (
        <button
          key={grade}
          type="button"
          onClick={() => onChange(grade)}
          className={cn('h-9 rounded-md border-2 px-4 text-sm font-medium transition-colors', grade === value ? GRADE_ON[grade] : 'hover:bg-muted')}
        >
          {QC_GRADE_LABEL[grade]}
        </button>
      ))}
    </div>
  );
}

function ReasonChips({ value, onChange }: { value: QcReason | null; onChange: (reason: QcReason) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {QC_REASONS.map(reason => (
        <button
          key={reason}
          type="button"
          onClick={() => onChange(reason)}
          className={cn(
            'h-7 rounded-full border px-3 text-xs transition-colors',
            reason === value ? 'border-overdue bg-overdue/10 font-medium text-overdue' : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {QC_REASON_LABEL[reason]}
        </button>
      ))}
    </div>
  );
}

function ItemReasons({ value, locked, onReason }: { value: Grade; locked: boolean; onReason: (reason: QcReason) => void }) {
  if (locked || value.grade !== QcGrade.BAD) {
    return null;
  }

  return <ReasonChips value={value.reason} onChange={onReason} />;
}

function ItemControls({ locked, value, onGrade }: { locked: boolean; value: Grade; onGrade: (grade: QcGrade) => void }) {
  if (locked) {
    return <span className="text-sm font-semibold text-overdue">Bad · Wrong item</span>;
  }

  return <GradeButtons value={value.grade} onChange={onGrade} />;
}

interface ItemRowProps {
  item: ReturnItem;
  value: Grade;
  locked: boolean;
  onChange: (value: Grade) => void;
}

function ItemRow({ item, value, locked, onChange }: ItemRowProps) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border p-3', locked && 'bg-overdue/5')}>
      <div className="flex items-center gap-3">
        <ItemImage url={item.catalogImageUrl} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.itemName ?? 'Unnamed item'}</p>

          <p className="text-xs text-muted-foreground">
            <Mono>{item.skuCode ?? '—'}</Mono> · {item.returnReason ?? 'no return reason'}
          </p>
        </div>

        <ItemControls locked={locked} value={value} onGrade={grade => onChange({ grade, reason: grade === QcGrade.GOOD ? null : value.reason })} />
      </div>

      <ItemReasons value={value} locked={locked} onReason={reason => onChange({ grade: QcGrade.BAD, reason })} />
    </div>
  );
}

// ---------------------------------------------------------------- dry run

function PayloadPreview({ payload, title }: { payload: UniwareQcPayload; title: string }) {
  return (
    <details className="rounded-xl border bg-muted/30 px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">{title}</summary>

      <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed">
        POST /services/rest/v1/oms/returns/complete{'\n'}
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

// ------------------------------------------------------------- QC states

function DoneView({ record }: { record: QcRecord }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl border-2 border-ok/40 bg-ok/10 px-5 py-3 text-ok">
        <CircleCheck className="size-6" />

        <span className="text-lg font-semibold">QC done</span>

        <span className="text-sm text-foreground">
          by {record.qcBy} {formatRelative(record.qcAt)} · shelf <Mono>{record.shelfCode}</Mono>
        </span>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {record.items.map(item => (
          <li key={item.code}>
            <span className={cn('font-medium', GRADE_TEXT[item.grade])}>{QC_GRADE_LABEL[item.grade]}</span> · {item.itemName}
            <span className="text-muted-foreground">{item.reason ? ` · ${QC_REASON_LABEL[item.reason]}` : ''}</span>
          </li>
        ))}
      </ul>

      <PayloadPreview payload={record.uniwarePayload} title="Uniware call (dry run: recorded here, not sent)" />
    </div>
  );
}

function NotReceivedWarning({ target }: { target: QcReturn }) {
  if (target.dockReceivedAt) {
    return null;
  }

  return (
    <p className="flex items-center gap-2 rounded-lg border border-overdue/40 bg-overdue/5 px-4 py-2 text-sm text-overdue">
      <TriangleAlert className="size-4" />
      This parcel was never received at the dock. Receive it first, then QC it.
    </p>
  );
}

interface ManualStepProps {
  target: QcReturn;
  grades: Grades;
  locked: Set<string>;
  check: QcMatchCheck | null;
  aiNote: string | null;
  onRetry: (() => void) | null;
  photo: string | null;
  onGrade: (code: string, value: Grade) => void;
  onSave: (shelf: string | null) => void;
  saving: boolean;
}

function ManualStep({ target, grades, locked, check, aiNote, onRetry, photo, onGrade, onSave, saving }: ManualStepProps) {
  const [shelf, setShelf] = useState('');

  const shelfCode = shelf.trim().toUpperCase();

  const ready = Boolean(target.dockReceivedAt) && !missingReason(grades) && !saving;

  function submit(event: FormEvent) {
    event.preventDefault();

    if (ready) {
      onSave(shelfCode || null);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <AiSummary check={check} target={target} photo={photo} />

      <AiNote note={aiNote} onRetry={onRetry} />

      <p className="text-sm font-semibold">{locked.size === target.items.length ? 'Moving to bad inventory' : 'Step 2 · Condition check'}</p>

      {target.items.map(item => (
        <ItemRow
          key={item.id}
          item={item}
          value={grades[item.saleOrderItemCode]}
          locked={locked.has(item.saleOrderItemCode)}
          onChange={value => onGrade(item.saleOrderItemCode, value)}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={shelf}
          onChange={e => setShelf(e.target.value)}
          placeholder="Scan shelf / bin (optional)"
          className="h-10 w-60 font-mono uppercase placeholder:font-sans placeholder:normal-case"
        />

        <Button type="submit" className="h-10 px-6" disabled={!ready}>
          Save QC
        </Button>
      </div>

      <PayloadPreview payload={previewPayload(target, grades, shelfCode)} title="What Uniware would receive (dry run, not sent)" />
    </form>
  );
}

function QcFlow({ target, onDone }: { target: QcReturn; onDone: (record: QcRecord) => void }) {
  const { scanner } = useDesk();

  const runCheck = useQcCheck();

  const submit = useSubmitQc();

  const [step, setStep] = useState<Step>(Step.PHOTO);

  const [photo, setPhoto] = useState<string | null>(null);

  const [check, setCheck] = useState<QcMatchCheck | null>(null);

  const [aiNote, setAiNote] = useState<string | null>(null);

  const [aiFailed, setAiFailed] = useState(false);

  const [locked, setLocked] = useState<Set<string>>(new Set());

  const [grades, setGrades] = useState<Grades>(() => gradesFor(target.items, new Set()));

  function onPhoto(next: string) {
    setPhoto(next);

    setStep(Step.CHECKING);

    setAiFailed(false);

    runCheck.mutate(
      { returnId: target.id, photo: next },
      {
        onSuccess: response => {
          setCheck(response.check);

          setAiNote(response.note);

          const mismatch = response.check?.verdict === MatchVerdict.MISMATCH;

          playSound(TONE_SOUND[mismatch ? OutcomeTone.BAD : OutcomeTone.GOOD]);

          setStep(mismatch ? Step.MISMATCH : Step.MANUAL);
        },
        onError: error => {
          setAiNote(`The smart check didn't run: ${error.message}.`);

          setAiFailed(true);

          setStep(Step.MANUAL);
        },
      }
    );
  }

  function confirmMismatch() {
    if (!check) {
      return;
    }

    const wrong = mismatchedCodes(check);

    setLocked(wrong);

    setGrades(gradesFor(target.items, wrong));

    setStep(Step.MANUAL);
  }

  function save(shelfCode: string | null) {
    if (!scanner) {
      return;
    }

    submit.mutate(
      { returnId: target.id, qcBy: scanner, shelfCode, items: toInputs(grades), photo, aiCheck: check },
      {
        onSuccess: record => {
          playSound(TONE_SOUND[OutcomeTone.GOOD]);

          toast.success(`QC saved for ${target.sourceCode}`);

          onDone(record);
        },
        onError: error => toast.error(error.message),
      }
    );
  }

  // A phone scan can open a parcel before anyone has said who is doing QC.
  if (!scanner) {
    return <p className="rounded-lg border border-warn/50 bg-warn/10 px-4 py-2 text-sm">Enter who is doing QC above to start.</p>;
  }

  if (step === Step.PHOTO) {
    return <PhotoStep target={target} onPhoto={onPhoto} onSkip={() => setStep(Step.MANUAL)} />;
  }

  if (step === Step.CHECKING) {
    return <CheckingStep photo={photo!} target={target} />;
  }

  if (step === Step.MISMATCH) {
    return <MismatchStep check={check!} target={target} photo={photo} onDone={confirmMismatch} />;
  }

  return (
    <ManualStep
      target={target}
      grades={grades}
      locked={locked}
      check={check}
      aiNote={aiNote}
      onRetry={aiFailed && photo ? () => onPhoto(photo) : null}
      photo={photo}
      onGrade={(code, value) => setGrades(current => ({ ...current, [code]: value }))}
      onSave={save}
      saving={submit.isPending}
    />
  );
}

function QcBody({ target, onDone }: { target: QcReturn; onDone: (record: QcRecord) => void }) {
  if (target.qc) {
    return <DoneView record={target.qc} />;
  }

  return (
    <>
      <NotReceivedWarning target={target} />

      <QcFlow key={target.id} target={target} onDone={onDone} />
    </>
  );
}

function Workspace({ lookup, onDone }: { lookup: QcLookupResponse | null; onDone: (record: QcRecord) => void }) {
  if (!lookup) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <PackageSearch className="size-8 text-muted-foreground" />

        <p className="text-sm font-medium">Scan a parcel to start QC</p>

        <p className="max-w-md text-sm text-muted-foreground">
          A smart check confirms it's the right product first. A wrong product fails right there; a right one goes to a quick condition check, then the shelf.
        </p>
      </div>
    );
  }

  if (!lookup.return) {
    return (
      <p className="rounded-xl border-2 border-overdue/40 bg-overdue/10 px-5 py-3 text-lg font-semibold text-overdue">
        No return with code <Mono className="text-base">{lookup.code}</Mono>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReturnFacts target={lookup.return} />

      <QcBody target={lookup.return} onDone={onDone} />
    </div>
  );
}

// ------------------------------------------------------------------ recent

function GradeSummary({ record }: { record: QcRecord }) {
  const bad = record.items.filter(item => item.grade === QcGrade.BAD).length;

  const good = record.items.length - bad;

  return (
    <span className="text-xs">
      <span className="text-ok">{good} good</span>
      <span className="text-overdue">{bad > 0 ? ` · ${bad} bad` : ''}</span>
    </span>
  );
}

/** Did the person go with the AI? A mismatch saved without a wrong item, or a match saved as one, was overruled. */
function AiOutcome({ record }: { record: QcRecord }) {
  const check = record.aiCheck;

  if (!check) {
    return <span className="text-xs text-muted-foreground">Skipped</span>;
  }

  const savedWrongItem = record.items.some(item => item.reason === QcReason.WRONG_ITEM);

  const overruled = (check.verdict === MatchVerdict.MISMATCH && !savedWrongItem) || (check.verdict === MatchVerdict.MATCH && savedWrongItem);

  return (
    <span className={cn('text-xs', VERDICT_TEXT[check.verdict])}>
      {MATCH_VERDICT_LABEL[check.verdict]}
      <span className="text-muted-foreground">{overruled ? ' · overruled' : ''}</span>
    </span>
  );
}

function RecentQc() {
  const { data } = useQcRecent();

  const rows = data?.data ?? [];

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Recent QC</h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Return</TableHead>
            <TableHead>Smart check</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Shelf</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Uniware</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map(row => (
            <TableRow key={row.id}>
              <TableCell className="text-muted-foreground">{formatDateTime(row.qcAt)}</TableCell>

              <TableCell>
                <Mono>{row.sourceCode}</Mono>
              </TableCell>

              <TableCell>
                <AiOutcome record={row} />
              </TableCell>

              <TableCell>
                <GradeSummary record={row} />
              </TableCell>

              <TableCell>
                <Mono>{row.shelfCode}</Mono>
              </TableCell>

              <TableCell>{row.qcBy}</TableCell>

              <TableCell className="text-xs text-muted-foreground">{row.pushedAt ? 'Sent' : 'Not sent (dry run)'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// -------------------------------------------------------------------- page

function useQcScan() {
  const lookup = useQcLookup();

  const [current, setCurrent] = useState<QcLookupResponse | null>(null);

  async function open(code: string) {
    try {
      const response = await lookup.mutateAsync(code);

      setCurrent(response);

      playSound(TONE_SOUND[REMOTE_OUTCOME[response.result].tone]);

      return response;
    } catch (error) {
      toast.error((error as Error).message);

      return null;
    }
  }

  return { current, setCurrent, open, pending: lookup.isPending };
}

export function QcPage() {
  const { scanner } = useDesk();

  const { current, setCurrent, open, pending } = useQcScan();

  const link = usePhoneLink(RemoteTarget.QC, ({ id, code }) => {
    void open(code).then(response => {
      if (response) {
        link.report(id, code, response.result);
      }
    });
  });

  // A finished QC shows its result until the next scan.
  function onDone(record: QcRecord) {
    setCurrent(previous => (previous?.return ? { ...previous, return: { ...previous.return, qc: record } } : previous));
  }

  return (
    <>
      <PageHeader
        title="QC station"
        description="A smart check confirms it's the right product, you check its condition, then the shelf. Recorded here; Uniware is not changed."
        actions={<PhoneScannerButton link={link} />}
      />

      <div className="flex max-w-5xl flex-col gap-6 px-6 py-6">
        <QcOperator />

        <ScanInput disabled={pending || !scanner} onScan={code => void open(code)} />

        <Workspace lookup={current} onDone={onDone} />

        <RecentQc />
      </div>
    </>
  );
}
