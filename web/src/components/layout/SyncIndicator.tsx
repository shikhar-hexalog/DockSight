import { Link } from 'react-router';

import { SyncStatus, type SyncStatusResponse } from '@hexabuild/shared';

import { Spinner } from '@/components/ui/spinner';
import { useSyncStatus } from '@/hooks/queries';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { routes } from '@/routes';

/** Sidebar: light text on the dark sidebar. Page: dark text, for the page header on narrow screens. */
type Placement = 'sidebar' | 'page';

const LOOK: Record<Placement, { link: string; failed: string }> = {
  sidebar: { link: 'text-sidebar-foreground hover:text-white', failed: 'text-[#ff8a8f]' },
  page: { link: 'text-muted-foreground hover:text-foreground', failed: 'text-overdue' },
};

function SyncLabel({ status, placement }: { status: SyncStatusResponse; placement: Placement }) {
  const latest = status.runs[0];

  if (status.running) {
    return (
      <span className="flex items-center gap-1.5">
        <Spinner className="size-3" />
        Syncing now
      </span>
    );
  }

  if (latest?.status === SyncStatus.FAILED) {
    return <span className={cn('font-medium', LOOK[placement].failed)}>Last sync failed</span>;
  }

  return <span>Synced {formatRelative(status.lastSuccessAt)}</span>;
}

/** When returns were last copied from Uniware. Opens the sync page, where a sync can be run by hand. */
export function SyncIndicator({ placement = 'sidebar' }: { placement?: Placement }) {
  const { data } = useSyncStatus();

  if (!data) {
    return null;
  }

  return (
    <Link to={routes.sync} className={cn('text-[12.5px] transition-colors', LOOK[placement].link)}>
      <SyncLabel status={data} placement={placement} />
    </Link>
  );
}
