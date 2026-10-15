import { Package } from 'lucide-react';

import { RETURN_TYPES, RETURN_TYPE_LABEL } from '@hexabuild/shared';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTypeFilter } from '@/hooks/useTypeFilter';

const ALL = 'ALL';

export function TypeFilter() {
  const { type, setType } = useTypeFilter();

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-label="Type" className="flex cursor-help text-muted-foreground">
            <Package className="size-4" />
          </span>
        </TooltipTrigger>

        <TooltipContent className="text-xs">
          <span className="font-medium">Type</span>: RTO (courier couldn't deliver) or DTO (customer returned it)
        </TooltipContent>
      </Tooltip>

      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={type ?? ALL}
        onValueChange={value => setType(RETURN_TYPES.find(t => t === value))}
      >
        <ToggleGroupItem value={ALL} className="h-8 px-2.5 text-xs">
          All
        </ToggleGroupItem>

        {RETURN_TYPES.map(t => (
          <ToggleGroupItem key={t} value={t} className="h-8 px-2.5 text-xs">
            {RETURN_TYPE_LABEL[t]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
