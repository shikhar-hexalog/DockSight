import type { ReactNode } from 'react';

import { SyncIndicator } from './SyncIndicator';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** For pages that show sync themselves (Uniware sync) or don't need it (Roadmap). */
  hideSyncIndicator?: boolean;
}

function Description({ text }: { text?: string }) {
  if (!text) {
    return null;
  }

  return <p className="mt-2 text-[13px] text-muted-foreground">{text}</p>;
}

/** When the data was last copied from Uniware: shown on every page, since the sidebar doesn't carry it. */
function HeaderSync({ hidden }: { hidden?: boolean }) {
  if (hidden) {
    return null;
  }

  return <SyncIndicator placement="page" />;
}

export function PageHeader({ title, description, actions, hideSyncIndicator }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-8 pt-7 pb-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-none font-semibold tracking-[-0.035em] text-ink">{title}</h1>

        <Description text={description} />
      </div>

      <div className="flex items-center gap-4">
        {actions}

        <HeaderSync hidden={hideSyncIndicator} />
      </div>
    </header>
  );
}
