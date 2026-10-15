// "Anything wrong?" after each scan, in two thin rows. Optional: the worker
// can ignore it and scan the next parcel. Picking an issue opens a note
// (saved with a button, confirmed on screen) and a photo (camera or upload).
// It applies to the latest scan unless a row in the log was picked.
// Shortcuts: Alt+1..4 toggle the issues on the selected parcel.

import { Check, Droplets, PackageOpen, PackageSearch, PackageX, X, type LucideIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

import { PARCEL_CONDITIONS, PARCEL_CONDITION_LABEL, ParcelCondition } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDesk } from '@/desk/DeskProvider';
import type { DeskScanEntry } from '@/desk/localDb';
import { cn } from '@/lib/utils';

import { PhotoPicker } from './PhotoPicker';

const SHORTCUT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

const CONDITION_ICON: Record<ParcelCondition, LucideIcon> = {
  [ParcelCondition.DAMAGED]: PackageX,
  [ParcelCondition.TAMPERED]: PackageOpen,
  [ParcelCondition.WET]: Droplets,
  [ParcelCondition.WRONG_ITEM]: PackageSearch,
};

function IssueButton({ condition, index, active, onClick }: { condition: ParcelCondition; index: number; active: boolean; onClick: () => void }) {
  const Icon = CONDITION_ICON[condition];

  return (
    <button
      type="button"
      onClick={onClick}
      // Keep the scan box focused, as with the barcode gun.
      onMouseDown={event => event.preventDefault()}
      aria-pressed={active}
      title={`Alt+${index + 1}`}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-sm border px-3 text-[13.5px] transition-colors',
        active ? 'border-overdue bg-overdue text-white' : 'border-input hover:border-ink hover:text-ink'
      )}
    >
      <Icon className="size-4" />
      {PARCEL_CONDITION_LABEL[condition]}
    </button>
  );
}

function NoteField({ entry, onSave }: { entry: DeskScanEntry; onSave: (note: string | null) => void }) {
  const [note, setNote] = useState(entry.conditionNote ?? '');

  useEffect(() => setNote(entry.conditionNote ?? ''), [entry.id, entry.conditionNote]);

  const saved = note.trim() === (entry.conditionNote ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!saved) {
      onSave(note.trim() || null);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-w-60 flex-1 gap-2">
      <Input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Add a note (optional), e.g. box crushed on one side"
        className="h-8 text-sm"
      />

      <Button type="submit" size="sm" variant={saved ? 'ghost' : 'default'} disabled={saved} className="h-8 min-w-20">
        <SaveLabel saved={saved} hasNote={Boolean(entry.conditionNote)} />
      </Button>
    </form>
  );
}

function SaveLabel({ saved, hasNote }: { saved: boolean; hasNote: boolean }) {
  if (saved && hasNote) {
    return (
      <>
        <Check /> Saved
      </>
    );
  }

  return <>Save note</>;
}

function PhotoField({ entry, photo, onPhoto }: { entry: DeskScanEntry; photo: string | undefined; onPhoto: (photo: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <PhotoPicker onPhoto={onPhoto} cameraTitle={`Photo of ${entry.code}`} />

      <PhotoThumb photo={photo} hasPhoto={entry.hasPhoto} />
    </div>
  );
}

function PhotoThumb({ photo, hasPhoto }: { photo: string | undefined; hasPhoto: boolean }) {
  if (photo) {
    return <img src={photo} alt="Parcel" className="size-8 rounded border object-cover" />;
  }

  if (hasPhoto) {
    return (
      <span className="flex items-center gap-1 text-xs text-ok">
        <Check className="size-3.5" /> Photo
      </span>
    );
  }

  return null;
}

function IssueDetails({
  entry,
  photo,
  onNote,
  onPhoto,
}: {
  entry: DeskScanEntry;
  photo: string | undefined;
  onNote: (note: string | null) => void;
  onPhoto: (photo: string) => void;
}) {
  if (!entry.condition) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NoteField entry={entry} onSave={onNote} />

      <PhotoField entry={entry} photo={photo} onPhoto={onPhoto} />
    </div>
  );
}

/** Only when tagging an earlier parcel from the list, say which one. */
function PickedCode({ entry, isLatest }: { entry: DeskScanEntry; isLatest: boolean }) {
  if (isLatest) {
    return null;
  }

  return (
    <span className="text-xs text-muted-foreground">
      Tagging <Mono className="text-xs text-foreground">{entry.code}</Mono>
    </span>
  );
}

function BackToLatest({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) {
    return null;
  }

  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <X className="size-3" />
      Back to latest scan
    </button>
  );
}

interface ConditionPanelProps {
  entry: DeskScanEntry | undefined;
  isLatest: boolean;
  onBackToLatest: () => void;
}

export function ConditionPanel({ entry, isLatest, onBackToLatest }: ConditionPanelProps) {
  const { tagScan } = useDesk();

  // Photos taken on this screen, to show as thumbnails (the desk only keeps a flag).
  const [photos, setPhotos] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!entry) {
      return;
    }

    const current = entry;

    function onKeyDown(event: KeyboardEvent) {
      const index = SHORTCUT_CODES.indexOf(event.code);

      if (!event.altKey || index < 0) {
        return;
      }

      event.preventDefault();

      const condition = PARCEL_CONDITIONS[index];

      void tagScan(current.id, { condition: current.condition === condition ? null : condition, note: current.conditionNote, photo: null });
    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [entry, tagScan]);

  if (!entry) {
    return null;
  }

  const current = entry;

  function toggle(condition: ParcelCondition) {
    void tagScan(current.id, { condition: current.condition === condition ? null : condition, note: current.conditionNote, photo: null });
  }

  function addPhoto(photo: string) {
    setPhotos(prev => ({ ...prev, [current.id]: photo }));

    void tagScan(current.id, { condition: current.condition, note: current.conditionNote, photo });
  }

  return (
    <section className="flex flex-col gap-2 border-b pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13.5px] font-medium text-ink">
          Anything wrong? <span className="font-normal text-muted-foreground">optional</span>
        </span>

        {PARCEL_CONDITIONS.map((condition, index) => (
          <IssueButton
            key={condition}
            condition={condition}
            index={index}
            active={current.condition === condition}
            onClick={() => toggle(condition)}
          />
        ))}

        <span className="ml-auto flex items-center gap-2">
          <PickedCode entry={current} isLatest={isLatest} />

          <BackToLatest show={!isLatest} onClick={onBackToLatest} />
        </span>
      </div>

      <IssueDetails
        entry={current}
        photo={photos[current.id]}
        onNote={note => void tagScan(current.id, { condition: current.condition, note, photo: null })}
        onPhoto={addPhoto}
      />
    </section>
  );
}
