import { EventType, type ReturnEvent, STAGE_LABEL, type Stage } from '@hexabuild/shared';

import { formatDateTime } from '@/lib/format';

function describe(event: ReturnEvent): string {
  const payload = event.payload ?? {};

  if (event.type === EventType.IMPORTED) {
    return `Imported from Uniware as ${STAGE_LABEL[payload.stage as Stage]?.toLowerCase() ?? 'new'}`;
  }

  if (event.type === EventType.STAGE_CHANGED) {
    return `Moved from ${STAGE_LABEL[payload.from as Stage]} to ${STAGE_LABEL[payload.to as Stage]}`;
  }

  if (event.type === EventType.RECEIVED_AT_DOCK) {
    return `${event.actor} scanned it at the dock`;
  }

  if (event.type === EventType.SCAN_REMOVED) {
    return `${event.actor} took back a dock scan (${String(payload.code ?? '')})`;
  }

  if (event.type === EventType.MANIFEST_ADDED) {
    return `${event.actor} added it to a ${String(payload.courier ?? '')} return manifest`;
  }

  if (event.type === EventType.MANIFEST_REMOVED) {
    return `${event.actor} took it out of a return manifest`;
  }

  if (event.type === EventType.QC_DONE) {
    return `${event.actor} did QC, put on shelf ${String(payload.shelfCode ?? '')}`;
  }

  if (event.type === EventType.SOURCE_UPDATED) {
    return `Updated in Uniware (${String(payload.sourceStatus ?? 'status unchanged')})`;
  }

  return event.type;
}

export function ReturnActivity({ events }: { events: ReturnEvent[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {events.map(event => (
        <li key={event.id} className="flex items-baseline justify-between gap-4">
          <span className="text-[13px]">{describe(event)}</span>

          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{formatDateTime(event.occurredAt)}</span>
        </li>
      ))}
    </ol>
  );
}
