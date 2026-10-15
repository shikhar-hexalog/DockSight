import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router';

import { SyncKind, SyncStatus, type SyncStatusResponse } from '@hexabuild/shared';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunSync, useSyncStatus } from '@/hooks/queries';
import { formatRelative } from '@/lib/format';
import { routes } from '@/routes';

function SyncLabel({ status }: { status: SyncStatusResponse }) {
  const latest = status.runs[0];

  if (status.running) {
    return (
      <span className="flex items-center gap-1.5">
        <Spinner className="size-3" />
        Syncing with Uniware
      </span>
    );
  }

  if (latest?.status === SyncStatus.FAILED) {
    return <span className="text-overdue">Last sync failed</span>;
  }

  return <span>Synced {formatRelative(status.lastSuccessAt)}</span>;
}

export function SyncIndicator() {
  const { data } = useSyncStatus();

  const runSync = useRunSync();

  if (!data) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5">
      <Link
        to={routes.sync}
        className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <SyncLabel status={data} />
      </Link>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Sync now"
            disabled={data.running || runSync.isPending}
            onClick={() => runSync.mutate(SyncKind.INCREMENTAL)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </TooltipTrigger>

        <TooltipContent>Sync now</TooltipContent>
      </Tooltip>
    </div>
  );
}
