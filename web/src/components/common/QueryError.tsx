import { CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface QueryErrorProps {
  error: Error;
  onRetry: () => void;
}

export function QueryError({ error, onRetry }: QueryErrorProps) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <div className="flex items-center gap-2 text-[14px] font-medium text-overdue">
        <CircleAlert className="size-4" />
        Couldn't load this
      </div>

      <p className="text-[13.5px] text-muted-foreground">{error.message}</p>

      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
