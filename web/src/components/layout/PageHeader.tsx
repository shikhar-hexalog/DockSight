import type { ReactNode } from 'react';

import { SyncIndicator } from './SyncIndicator';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  hideSyncIndicator?: boolean;
}

function HeaderSync({ hidden }: { hidden: boolean }) {
  if (hidden) {
    return null;
  }

  return <SyncIndicator />;
}

export function PageHeader({ title, description, actions, hideSyncIndicator = false }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b px-6 pt-5 pb-4">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>

        <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
      </div>

      <div className="flex items-center gap-2">
        {actions}

        <HeaderSync hidden={hideSyncIndicator} />
      </div>
    </header>
  );
}
