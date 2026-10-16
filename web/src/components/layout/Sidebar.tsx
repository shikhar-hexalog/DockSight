import {
  ArrowLeftRight,
  ChartColumn,
  ClipboardCheck,
  Columns3,
  Hourglass,
  LayoutDashboard,
  MessageSquareText,
  Milestone,
  type LucideIcon,
  PackageX,
  Rows3,
  ScanBarcode,
  Truck,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { type FocusEvent, type ReactNode, useState } from 'react';
import { NavLink } from 'react-router';

import { type OverviewResponse, UniwareMode } from '@hexabuild/shared';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
      { to: routes.qc, label: 'QC', icon: ClipboardCheck },
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
  {
    label: 'Future plan',
    items: [{ to: routes.roadmap, label: 'Roadmap', icon: Milestone }],
  },
];

const PANEL_CLOSED = '3.05rem';

const PANEL_OPEN = '14rem';

const PANEL_TRANSITION = { type: 'tween', ease: 'easeOut', duration: 0.2 } as const;

const LABEL_TRANSITION = { duration: 0.15 } as const;

/** Text that only shows once the panel is open, fading in beside its icon. */
function Reveal({ expanded, className, children }: { expanded: boolean; className?: string; children: ReactNode }) {
  if (!expanded) {
    return null;
  }

  return (
    <motion.span
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={LABEL_TRANSITION}
      className={cn('flex items-center whitespace-nowrap', className)}
    >
      {children}
    </motion.span>
  );
}

function Brand({ expanded }: { expanded: boolean }) {
  return (
    <div className="flex items-center gap-2.5 pl-2.5">
      <div className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground font-mono text-[13px] font-semibold text-background">H</div>

      <Reveal expanded={expanded}>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold">Hexalog</span>

          <span className="block text-[11px] text-muted-foreground">Returns desk</span>
        </span>
      </Reveal>
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

  return <span className="ml-auto pl-3 font-mono text-[11px] text-muted-foreground tabular-nums">{formatCount(value)}</span>;
}

function NavEntry({ item, expanded }: { item: NavItem; expanded: boolean }) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.to === routes.overview}
      title={item.label}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
          isActive ? 'bg-muted font-medium text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        )
      }
    >
      <Icon className="size-4 shrink-0" />

      <Reveal expanded={expanded} className="min-w-0 flex-1">
        {item.label}

        <NavCount item={item} />
      </Reveal>
    </NavLink>
  );
}

/** The group's name when open; a thin rule between groups when it's just icons. */
function SectionHeading({ label, expanded }: { label: string; expanded: boolean }) {
  if (!expanded) {
    return <Separator className="my-1.5" />;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={LABEL_TRANSITION}
      className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
    >
      {label}
    </motion.div>
  );
}

function NavSection({ group, expanded }: { group: NavGroup; expanded: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <SectionHeading label={group.label} expanded={expanded} />

      {group.items.map(item => (
        <NavEntry key={item.to} item={item} expanded={expanded} />
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<UniwareMode, string> = {
  [UniwareMode.LIVE]: 'Uniware live',
  [UniwareMode.MOCK]: 'Mock data',
  [UniwareMode.IMPORT]: 'Uniware export',
};

function SourceBadge({ expanded }: { expanded: boolean }) {
  const { data } = useSyncStatus();

  if (!data) {
    return null;
  }

  const live = data.mode === UniwareMode.LIVE;

  const dot = <span className={cn('size-1.5 shrink-0 rounded-full', live ? 'bg-ok' : 'bg-warn')} />;

  if (!expanded) {
    return (
      <div title={SOURCE_LABEL[data.mode]} className="grid h-8 place-items-center">
        {dot}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background px-2.5 py-2 whitespace-nowrap">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        {dot}

        {SOURCE_LABEL[data.mode]}
      </div>

      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{(data.accounts ?? []).map(a => a.facility).join(' · ')}</div>
    </div>
  );
}

/**
 * A slim icon rail that opens over the page while hovered or focused, so it
 * only takes room when it's being used. The rail's width is held by the aside;
 * the panel inside grows over the content instead of pushing it.
 */
export function Sidebar() {
  const [expanded, setExpanded] = useState(false);

  function closeUnlessFocusStays(event: FocusEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setExpanded(false);
  }

  return (
    <aside className="relative z-40 hidden shrink-0 md:block" style={{ width: PANEL_CLOSED }}>
      <motion.div
        initial={false}
        animate={{ width: expanded ? PANEL_OPEN : PANEL_CLOSED }}
        transition={PANEL_TRANSITION}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlurCapture={closeUnlessFocusStays}
        className={cn('absolute inset-y-0 left-0 flex flex-col gap-4 overflow-hidden border-r bg-background py-4', expanded && 'shadow-xl')}
      >
        <Brand expanded={expanded} />

        <ScrollArea className="min-h-0 flex-1">
          <nav className="flex flex-col gap-3 px-2">
            {NAV_GROUPS.map(group => (
              <NavSection key={group.label} group={group} expanded={expanded} />
            ))}
          </nav>
        </ScrollArea>

        <div className="px-2">
          <SourceBadge expanded={expanded} />
        </div>
      </motion.div>
    </aside>
  );
}
