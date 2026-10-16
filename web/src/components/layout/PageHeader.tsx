import type { ReactNode } from 'react';

import { SyncIndicator } from './SyncIndicator';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-8 pt-7 pb-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-none font-semibold tracking-[-0.035em] text-ink">{title}</h1>

        {description && <p className="mt-2 text-[13px] text-muted-foreground">{description}</p>}

        {/* The sidebar, which normally shows sync status, is hidden on narrow screens. */}
        <div className="mt-1.5 md:hidden">
          <SyncIndicator placement="page" />
        </div>
      </div>

      <div className="flex items-center gap-4">{actions}</div>
    </header>
  );
}
