import { Link } from 'react-router';

import { SyncStatus, type SyncStatusResponse } from '@hexabuild/shared';

import { Spinner } from '@/components/ui/spinner';
import { useSyncStatus } from '@/hooks/queries';
import { formatRelative } from '@/lib/format';
import { routes } from '@/routes';

function SyncLabel({ status }: { status: SyncStatusResponse }) {
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
    return <span className="font-medium text-[#ff8a8f]">Last sync failed</span>;
  }

  return <span>Synced {formatRelative(status.lastSuccessAt)}</span>;
}

/** When returns were last copied from Uniware. Opens the sync page, where a sync can be run by hand. */
export function SyncIndicator() {
  const { data } = useSyncStatus();

  if (!data) {
    return null;
  }

  return (
    <Link to={routes.sync} className="text-[12.5px] text-sidebar-foreground transition-colors hover:text-white">
      <SyncLabel status={data} />
    </Link>
  );
}
