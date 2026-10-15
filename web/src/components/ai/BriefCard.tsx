import { ActionPriority, AiProviderName, BRIEF_KIND_LABEL, type Brief, BriefTrigger } from '@hexabuild/shared';

import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function Meta({ brief }: { brief: Brief }) {
  const how = brief.trigger === BriefTrigger.SCHEDULED ? 'Sent automatically' : 'Written on request';

  const delivery = brief.delivery ? ` · ${brief.delivery}` : '';

  return (
    <p className="text-[12.5px] text-muted-foreground">
      {BRIEF_KIND_LABEL[brief.kind]} · {formatDateTime(brief.createdAt)} · {how}
      {delivery}
    </p>
  );
}

function OwnerChip({ owner }: { owner: string | null }) {
  if (!owner) {
    return null;
  }

  return <span className="font-normal text-muted-foreground"> · {owner}</span>;
}

function MockNote({ provider }: { provider: string }) {
  if (provider !== AiProviderName.MOCK) {
    return null;
  }

  return <p className="text-[12.5px] text-warn">Written in mock mode from fixed templates, not by the smart engine.</p>;
}

/** A brief laid out for reading: headline, summary, sections, then actions. */
export function BriefCard({ brief }: { brief: Brief }) {
  const { content } = brief;

  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Meta brief={brief} />

        <h2 className="font-display text-[24px] leading-[1.2] font-semibold tracking-[-0.03em] text-balance text-ink">{content.headline}</h2>

        <p className="text-[15px] leading-relaxed text-muted-foreground">{content.summary}</p>
      </div>

      <MockNote provider={brief.provider} />

      {content.sections.map(section => (
        <section key={section.title} className="flex flex-col gap-2">
          <h3 className="border-b pb-1.5 font-display text-[14px] font-semibold text-ink">{section.title}</h3>

          <ul className="flex flex-col gap-1.5">
            {section.points.map(point => (
              <li key={point} className="text-[14px] leading-relaxed">
                {point}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-2">
        <h3 className="border-b border-ink pb-1.5 font-display text-[14px] font-semibold text-ink">Next actions</h3>

        <ol className="flex flex-col">
          {content.actions.map(action => {
            const urgent = action.priority === ActionPriority.HIGH;

            // Urgent actions in red and bold, not marked with a dot.
            return (
              <li key={action.action} aria-label={urgent ? `Urgent: ${action.action}` : undefined} className={cn('border-b py-2 text-[14px]', urgent && 'font-medium text-overdue')}>
                {action.action}
                <OwnerChip owner={action.owner} />
              </li>
            );
          })}
        </ol>
      </section>
    </article>
  );
}
