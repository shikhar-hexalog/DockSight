import { CircleAlert } from 'lucide-react';
import { useRouteError } from 'react-router';

import { Button } from '@/components/ui/button';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

/**
 * Shown instead of a blank page when a screen crashes. Work saved on the
 * phone is in its own storage, so reloading never loses it.
 */
export function RouteError() {
  const error = useRouteError();

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <CircleAlert className="size-8 text-overdue" />

        <h1 className="text-lg font-semibold">This screen hit a problem</h1>

        <p className="text-sm text-muted-foreground">Reloading usually fixes it. Anything saved on this device is kept.</p>

        <p className="font-mono text-xs text-muted-foreground">{errorMessage(error)}</p>

        <Button size="lg" className="mt-2 h-12 w-full" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
