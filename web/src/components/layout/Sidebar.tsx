import {
  ArrowLeftRight,
  ChartColumn,
  Columns3,
  Hourglass,
  LayoutDashboard,
  MessageSquareText,
  type LucideIcon,
  PackageX,
  Rows3,
  ScanBarcode,
  Truck,
} from 'lucide-react';
import { NavLink } from 'react-router';

import { type OverviewResponse, UniwareMode } from '@hexabuild/shared';

import { useOverview, useSyncStatus } from '@/hooks/queries';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { routes } from '@/routes';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** A live count shown beside the label, e.g. how many are pending. */
  count?: (overview: OverviewResponse) => number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Today',
    items: [
      { to: routes.overview, label: 'Overview', icon: LayoutDashboard },
      { to: routes.board, label: 'Board', icon: Columns3 },
      { to: routes.receive, label: 'Receive', icon: ScanBarcode },
      { to: routes.dispatch, label: 'Dispatch', icon: Truck, count: o => o.dispatch.open },
      { to: routes.pending, label: 'Pending in Uniware', icon: Hourglass, count: o => o.pending.total },
      { to: routes.exceptions, label: 'Set aside', icon: PackageX, count: o => o.exceptionsOpen },
    ],
  },
  {
    label: 'Look up',
    items: [
      { to: routes.ai, label: 'Briefs & questions', icon: MessageSquareText },
      { to: routes.reports, label: 'Reports', icon: ChartColumn },
      { to: routes.returns, label: 'All returns', icon: Rows3 },
      { to: routes.sync, label: 'Uniware sync', icon: ArrowLeftRight },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid size-7 place-items-center rounded-md bg-foreground font-mono text-[13px] font-semibold text-background">
        H
      </div>

      <div className="leading-tight">
        <div className="text-[13px] font-semibold">Hexalog</div>

        <div className="text-[11px] text-muted-foreground">Returns desk</div>
      </div>
    </div>
  );
}

function NavCount({ item }: { item: NavItem }) {
  const { data } = useOverview();

  if (!item.count || !data) {
    return null;
  }

  const value = item.count(data);

  if (value === 0) {
    return null;
  }

  return <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{formatCount(value)}</span>;
}

function NavEntry({ item }: { item: NavItem }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.to === routes.overview}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
          isActive
            ? 'bg-background font-medium text-foreground shadow-xs ring-1 ring-border'
            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
        )
      }
    >
      <Icon className="size-4" />

      {item.label}

      <NavCount item={item} />
    </NavLink>
  );
}

function NavSection({ group }: { group: NavGroup }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{group.label}</div>

      {group.items.map(item => (
        <NavEntry key={item.to} item={item} />
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<UniwareMode, string> = {
  [UniwareMode.LIVE]: 'Uniware live',
  [UniwareMode.MOCK]: 'Mock data',
  [UniwareMode.IMPORT]: 'Uniware export',
};

function SourceBadge() {
  const { data } = useSyncStatus();

  if (!data) {
    return null;
  }

  const live = data.mode === UniwareMode.LIVE;

  return (
    <div className="rounded-md border bg-background px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        <span className={cn('size-1.5 rounded-full', live ? 'bg-ok' : 'bg-warn')} />
        {SOURCE_LABEL[data.mode]}
      </div>

      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{(data.accounts ?? []).map(a => a.facility).join(' · ')}</div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r bg-muted/40 px-3 py-4 md:flex">
      <Brand />

      <nav className="flex flex-col gap-5">
        {NAV_GROUPS.map(group => (
          <NavSection key={group.label} group={group} />
        ))}
      </nav>

      <div className="mt-auto">
        <SourceBadge />
      </div>
    </aside>
  );
}
