import { NavLink } from 'react-router';

import { type OverviewResponse, UniwareMode } from '@hexabuild/shared';

import { useOverview, useSyncStatus } from '@/hooks/queries';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { routes } from '@/routes';

import { HexalogLogo } from './HexalogLogo';
import { SyncIndicator } from './SyncIndicator';

interface NavItem {
  to: string;
  label: string;
  /** A live count shown beside the label, e.g. how many are pending. */
  count?: (overview: OverviewResponse) => number;
  /** The count is work someone must do before a deadline: shown in the signal colour. */
  urgent?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Today',
    items: [
      { to: routes.overview, label: 'Overview' },
      { to: routes.board, label: 'Board' },
      { to: routes.receive, label: 'Receive' },
      { to: routes.dispatch, label: 'Dispatch', count: o => o.dispatch.open, urgent: true },
      { to: routes.pending, label: 'Pending in Uniware', count: o => o.pending.total },
      { to: routes.exceptions, label: 'Set aside', count: o => o.exceptionsOpen },
    ],
  },
  {
    label: 'Look up',
    items: [
      { to: routes.ai, label: 'Briefs & questions' },
      { to: routes.reports, label: 'Reports' },
      { to: routes.returns, label: 'All returns' },
      { to: routes.sync, label: 'Uniware sync' },
    ],
  },
];

function Brand() {
  return (
    <div className="flex flex-col gap-1.5">
      <HexalogLogo className="h-[22px] w-auto self-start text-white" />

      <span className="text-[12px] text-sidebar-foreground/70">Returns desk</span>
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

  return <span className={cn('ml-1.5 tabular-nums', item.urgent ? 'font-semibold text-signal' : 'text-sidebar-foreground/70')}>{formatCount(value)}</span>;
}

function NavEntry({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === routes.overview}
      className={({ isActive }) =>
        cn('block py-[5px] text-[14px] transition-colors', isActive ? 'font-semibold text-white' : 'text-sidebar-foreground hover:text-white')
      }
    >
      {item.label}

      <NavCount item={item} />
    </NavLink>
  );
}

function NavSection({ group }: { group: NavGroup }) {
  return (
    <div className="flex flex-col">
      <div className="pb-1.5 text-[12px] text-sidebar-foreground/60">{group.label}</div>

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

function Source() {
  const { data } = useSyncStatus();

  if (!data) {
    return null;
  }

  const facilities = (data.accounts ?? []).map(a => a.facility).join(' · ');

  return (
    <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-4">
      <p className={cn('text-[13px] font-medium', data.mode === UniwareMode.LIVE ? 'text-white' : 'text-signal')}>{SOURCE_LABEL[data.mode]}</p>

      {facilities && <p className="text-[12.5px] text-sidebar-foreground">{facilities}</p>}

      <SyncIndicator />
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-52 shrink-0 flex-col gap-7 bg-sidebar px-4 py-5 md:flex">
      <Brand />

      <nav className="flex flex-col gap-5">
        {NAV_GROUPS.map(group => (
          <NavSection key={group.label} group={group} />
        ))}
      </nav>

      <div className="mt-auto">
        <Source />
      </div>
    </aside>
  );
}
