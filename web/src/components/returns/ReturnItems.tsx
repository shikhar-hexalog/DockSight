import type { ReturnItem } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { cn } from '@/lib/utils';

// Uniware's QC result for a returned item.
const InventoryType = {
  GOOD: 'GOOD_INVENTORY',
  BAD: 'BAD_INVENTORY',
} as const;

function ItemThumb({ item }: { item: ReturnItem }) {
  if (item.catalogImageUrl) {
    return <img src={item.catalogImageUrl} alt="" className="size-12 shrink-0 rounded-md border object-cover" loading="lazy" />;
  }

  const initials = (item.skuCode ?? '??').slice(0, 3);

  return (
    <div className="grid size-12 shrink-0 place-items-center rounded-md border bg-muted font-mono text-[10px] text-muted-foreground">
      {initials}
    </div>
  );
}

function InventoryLabel({ type }: { type: string | null }) {
  if (type === InventoryType.GOOD) {
    return <span className="text-xs font-medium text-ok">Good inventory</span>;
  }

  if (type === InventoryType.BAD) {
    return <span className="text-xs font-medium text-overdue">Bad inventory</span>;
  }

  return <span className="text-xs text-muted-foreground">Not QC'd yet</span>;
}

function QcComment({ comment }: { comment: string | null }) {
  if (!comment) {
    return null;
  }

  return <p className="mt-1 text-xs text-muted-foreground">QC: {comment}</p>;
}

function ItemRow({ item, last }: { item: ReturnItem; last: boolean }) {
  return (
    <li className={cn('flex gap-3 py-3', !last && 'border-b')}>
      <ItemThumb item={item} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{item.itemName ?? 'Unnamed item'}</p>

        <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
          <Mono className="text-[11px]">{item.skuCode ?? '—'}</Mono>

          <span className="text-border">·</span>

          <InventoryLabel type={item.inventoryType} />
        </div>

        <p className="mt-1 text-xs">{item.returnReason ?? 'No reason given'}</p>

        <QcComment comment={item.putawayQcComment} />
      </div>
    </li>
  );
}

export function ReturnItems({ items }: { items: ReturnItem[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <ItemRow key={item.id} item={item} last={index === items.length - 1} />
      ))}
    </ul>
  );
}
