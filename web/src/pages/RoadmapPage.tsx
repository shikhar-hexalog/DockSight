import { Check, type LucideIcon, Plane, Warehouse } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/utils';
import { routes } from '@/routes';

const ModuleStatus = {
  LIVE: 'LIVE',
  NEXT: 'NEXT',
  LATER: 'LATER',
} as const;
type ModuleStatus = (typeof ModuleStatus)[keyof typeof ModuleStatus];

interface Feature {
  label: string;
  /** Where it lives in the app, for modules that are already live. */
  to?: string;
}

interface Module {
  name: string;
  status: ModuleStatus;
  summary: string;
  features: Feature[];
}

interface BusinessLine {
  name: string;
  icon: LucideIcon;
  modules: Module[];
}

const STATUS_LABEL: Record<ModuleStatus, string> = {
  [ModuleStatus.LIVE]: 'Live today',
  [ModuleStatus.NEXT]: 'Next',
  [ModuleStatus.LATER]: 'Later',
};

const STATUS_BADGE: Record<ModuleStatus, string> = {
  [ModuleStatus.LIVE]: 'bg-ok/10 text-ok',
  [ModuleStatus.NEXT]: 'bg-stage-expected/10 text-stage-expected',
  [ModuleStatus.LATER]: 'bg-muted text-muted-foreground',
};

const STATUS_CARD: Record<ModuleStatus, string> = {
  [ModuleStatus.LIVE]: 'bg-background ring-2 ring-ok',
  [ModuleStatus.NEXT]: 'bg-background ring-1 ring-stage-expected/40',
  [ModuleStatus.LATER]: 'border-2 border-dashed bg-muted/30',
};

const BUSINESS_LINES: BusinessLine[] = [
  {
    name: 'Air network',
    icon: Plane,
    modules: [
      {
        name: 'Air courier',
        status: ModuleStatus.LATER,
        summary: 'Air shipments in and out',
        features: [{ label: 'Dashboard' }, { label: 'Received scan' }, { label: 'Dispatch scan' }, { label: 'Labels with pendency and box count' }],
      },
    ],
  },
  {
    name: 'Warehouse',
    icon: Warehouse,
    modules: [
      {
        name: 'Inward',
        status: ModuleStatus.NEXT,
        summary: 'Vehicle unloading and PO matching',
        features: [{ label: 'Dashboard' }, { label: 'Unloading scan' }, { label: 'PO / GRN matching' }, { label: 'Signed unloading sheet' }],
      },
      {
        name: 'Returns',
        status: ModuleStatus.LIVE,
        summary: 'RTO and DTO, dock to shelf, on Uniware',
        features: [
          { label: 'Overview and board, 4 stages', to: routes.board },
          { label: 'Receive desk, offline, phone scanner', to: routes.receive },
          { label: 'Handover with condition and signed sheet', to: routes.receive },
          { label: 'Manifest made from each handover', to: routes.manifest },
          { label: 'Smart product check at QC', to: routes.qc },
          { label: 'Dispatch guard for cancelled orders', to: routes.dispatch },
          { label: 'Reports by inward date', to: routes.reports },
        ],
      },
    ],
  },
];

const MODULE_COUNT = BUSINESS_LINES.reduce((sum, line) => sum + line.modules.length, 0);

/** Where each business line's modules start in the full row of modules. */
const LINE_OFFSETS = BUSINESS_LINES.map((_, i) => BUSINESS_LINES.slice(0, i).reduce((sum, line) => sum + line.modules.length, 0));

const CROSS_MODULE_REPORTS = ['Picker', 'Dispatch', 'Returns processed', 'Done'];

const SHARED_BLOCKS = [
  'Offline scan desk',
  'Phone as scanner',
  'Handover and signed sheet',
  'Condition tags and photos',
  'WMS connectors (Uniware first)',
  'Working-hours clock',
  'Reports and exports',
  'Smart briefs',
];

const LINE = 'bg-muted-foreground/35';

/** A straight line down from the node above to the centre of the next node. */
function Stem() {
  return <div className={cn('mx-auto hidden h-6 w-px md:block', LINE)} />;
}

/** The connector above one branch: half of the shared bar on each side, then a line down. */
function BranchIn({ first, last }: { first: boolean; last: boolean }) {
  return (
    <div className="relative hidden h-6 md:block">
      <span className={cn('absolute top-0 left-0 h-px w-1/2', LINE, first && 'invisible')} />

      <span className={cn('absolute top-0 right-0 h-px w-1/2', LINE, last && 'invisible')} />

      <span className={cn('absolute top-0 left-1/2 h-full w-px', LINE)} />
    </div>
  );
}

/** The mirror of BranchIn below a branch: a line down, then half of the shared bar that merges the branches. */
function BranchOut({ first, last }: { first: boolean; last: boolean }) {
  return (
    <div className="relative hidden h-6 md:block">
      <span className={cn('absolute top-0 left-1/2 h-full w-px', LINE)} />

      <span className={cn('absolute bottom-0 left-0 h-px w-1/2', LINE, first && 'invisible')} />

      <span className={cn('absolute right-0 bottom-0 h-px w-1/2', LINE, last && 'invisible')} />
    </div>
  );
}

interface BranchProps {
  index: number;
  count: number;
  children: ReactNode;
  /** How many module columns this branch spans, so every module column ends up the same width. */
  span: number;
}

function Branch({ index, count, children, span }: BranchProps) {
  return (
    <div className="flex min-w-0 flex-col" style={{ flex: span }}>
      <BranchIn first={index === 0} last={index === count - 1} />

      <div className="flex flex-1 flex-col px-2">{children}</div>
    </div>
  );
}

function RootNode() {
  return (
    <div className="mx-auto rounded-full bg-foreground px-5 py-2 text-[13px] font-semibold text-background">
      Hexalog Ops
      <span className="ml-2 font-normal opacity-60">one platform</span>
    </div>
  );
}

function LineNode({ line }: { line: BusinessLine }) {
  const Icon = line.icon;

  return (
    <div className="mx-auto flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-[13px] font-medium shadow-xs">
      <Icon className="size-4 text-muted-foreground" />

      {line.name}
    </div>
  );
}

function StatusBadge({ status }: { status: ModuleStatus }) {
  return <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11px] font-medium', STATUS_BADGE[status])}>{STATUS_LABEL[status]}</span>;
}

function FeatureText({ feature }: { feature: Feature }) {
  if (!feature.to) {
    return <span>{feature.label}</span>;
  }

  return (
    <Link to={feature.to} className="underline-offset-4 hover:underline">
      {feature.label}
    </Link>
  );
}

function FeatureMark({ status }: { status: ModuleStatus }) {
  if (status === ModuleStatus.LIVE) {
    return <Check className="size-3.5 shrink-0 text-ok" />;
  }

  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />;
}

function ModuleCard({ module }: { module: Module }) {
  return (
    <div className={cn('flex flex-1 flex-col rounded-xl p-4', STATUS_CARD[module.status])}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{module.name}</h2>

        <StatusBadge status={module.status} />
      </div>

      <p className="mt-1 text-[12px] text-muted-foreground">{module.summary}</p>

      <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
        {module.features.map(feature => (
          <li key={feature.label} className="flex items-center gap-2">
            <FeatureMark status={module.status} />

            <FeatureText feature={feature} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModuleBranches({ line, offset }: { line: BusinessLine; offset: number }) {
  return (
    <div className="flex flex-1 flex-col gap-4 md:flex-row md:gap-0">
      {line.modules.map((module, i) => (
        <ModuleBranch key={module.name} module={module} index={offset + i} />
      ))}
    </div>
  );
}

/** A module column. Its merge connector is indexed across all modules, so the bar below joins every column. */
function ModuleBranch({ module, index }: { module: Module; index: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Stem />

      <div className="flex flex-1 flex-col px-2">
        <ModuleCard module={module} />
      </div>

      <BranchOut first={index === 0} last={index === MODULE_COUNT - 1} />
    </div>
  );
}

function LineBranch({ line, index, offset }: { line: BusinessLine; index: number; offset: number }) {
  return (
    <Branch index={index} count={BUSINESS_LINES.length} span={line.modules.length}>
      <LineNode line={line} />

      <LineModules line={line} offset={offset} />
    </Branch>
  );
}

function LineModules({ line, offset }: { line: BusinessLine; offset: number }) {
  return (
    <div className="-mx-2 flex flex-1 flex-col pt-4 md:pt-0">
      <ModuleBar count={line.modules.length} />

      <ModuleBranches line={line} offset={offset} />
    </div>
  );
}

/** The bar a business line hangs its modules from: a stem, then a bar between the first and last module centres. */
function ModuleBar({ count }: { count: number }) {
  const inset = `${50 / count}%`;

  return (
    <div className="relative hidden h-6 md:block">
      <span className={cn('absolute top-0 left-1/2 h-full w-px', LINE)} />

      <span className={cn('absolute bottom-0 h-px', LINE)} style={{ left: inset, right: inset }} />
    </div>
  );
}

function BusinessLines() {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-0">
      {BUSINESS_LINES.map((line, i) => (
        <LineBranch key={line.name} line={line} index={i} offset={LINE_OFFSETS[i]} />
      ))}
    </div>
  );
}

function ReportsNode() {
  return (
    <div className="mx-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl border bg-background px-5 py-3 text-[13px]">
      <span className="font-medium">Reports across modules</span>

      {CROSS_MODULE_REPORTS.map(report => (
        <span key={report} className="text-muted-foreground">
          {report}
        </span>
      ))}
    </div>
  );
}

function SharedPlatform() {
  return (
    <div className="mx-2 rounded-xl bg-foreground px-5 py-4 text-background">
      <div className="text-center text-[12px] opacity-70">Shared platform, built once, reused by every module</div>

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {SHARED_BLOCKS.map(block => (
          <span key={block} className="rounded-md bg-background/10 px-2.5 py-1 text-[12px] ring-1 ring-background/15">
            {block}
          </span>
        ))}
      </div>
    </div>
  );
}

function Flowchart() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 md:gap-0">
      <RootNode />

      <Stem />

      <BusinessLines />

      <Stem />

      <ReportsNode />

      <Stem />

      <SharedPlatform />
    </div>
  );
}

export function RoadmapPage() {
  return (
    <>
      <PageHeader title="Roadmap" description="Returns is module one. The same building blocks run inward and air courier next." hideSyncIndicator />

      <div className="px-6 py-6">
        <Flowchart />
      </div>
    </>
  );
}
