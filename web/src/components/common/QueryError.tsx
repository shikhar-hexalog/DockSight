import { CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface QueryErrorProps {
  error: Error;
  onRetry: () => void;
}

export function QueryError({ error, onRetry }: QueryErrorProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert className="size-4 text-overdue" />
        Couldn't load this
      </div>

      <p className="text-sm text-muted-foreground">{error.message}</p>

      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
