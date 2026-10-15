import { ActionPriority, AiProviderName, BRIEF_KIND_LABEL, type Brief, BriefTrigger } from '@hexabuild/shared';

import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function Meta({ brief }: { brief: Brief }) {
  const how = brief.trigger === BriefTrigger.SCHEDULED ? 'Sent automatically' : 'Written on request';

  const delivery = brief.delivery ? ` · ${brief.delivery}` : '';

  return (
    <p className="text-xs text-muted-foreground">
      {BRIEF_KIND_LABEL[brief.kind]} · {formatDateTime(brief.createdAt)} · {how}
      {delivery}
    </p>
  );
}

function PriorityMark({ priority }: { priority: ActionPriority }) {
  return (
    <span
      aria-label={priority === ActionPriority.HIGH ? 'Urgent' : undefined}
      className={cn('mt-1.5 size-2 shrink-0 rounded-full', priority === ActionPriority.HIGH ? 'bg-overdue' : 'bg-border')}
    />
  );
}

function OwnerChip({ owner }: { owner: string | null }) {
  if (!owner) {
    return null;
  }

  return <span className="ml-2 rounded-[4px] border px-1.5 py-0.5 text-[11px] text-muted-foreground">{owner}</span>;
}

function MockNote({ provider }: { provider: string }) {
  if (provider !== AiProviderName.MOCK) {
    return null;
  }

  return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Written in mock mode from fixed templates, not by the smart engine.</p>;
}

/** A brief laid out for reading: headline, summary, sections, then actions. */
export function BriefCard({ brief }: { brief: Brief }) {
  const { content } = brief;

  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Meta brief={brief} />

        <h2 className="text-xl font-semibold tracking-tight text-balance">{content.headline}</h2>

        <p className="text-[14px] leading-relaxed text-muted-foreground">{content.summary}</p>
      </div>

      <MockNote provider={brief.provider} />

      {content.sections.map(section => (
        <section key={section.title} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{section.title}</h3>

          <ul className="flex flex-col gap-1.5">
            {section.points.map(point => (
              <li key={point} className="text-[14px] leading-relaxed">
                {point}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Next actions</h3>

        <ol className="flex flex-col gap-2.5">
          {content.actions.map(action => (
            <li key={action.action} className="flex gap-2.5 text-[14px]">
              <PriorityMark priority={action.priority} />

              <span>
                {action.action}
                <OwnerChip owner={action.owner} />
              </span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
