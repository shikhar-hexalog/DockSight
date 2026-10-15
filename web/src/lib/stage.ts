import { Stage } from '@hexabuild/shared';

/** Tailwind classes for each stage's colour dot. */
export const STAGE_DOT_CLASS: Record<Stage, string> = {
  [Stage.EXPECTED]: 'bg-stage-expected',
  [Stage.RECEIVED]: 'bg-stage-pending',
  [Stage.PROCESSED]: 'bg-stage-processed',
  [Stage.CANCELLED]: 'bg-stage-cancelled',
};

export const STAGE_HINT: Record<Stage, string> = {
  [Stage.EXPECTED]: 'Uniware expects it; not at the warehouse yet',
  [Stage.RECEIVED]: 'At the warehouse, not yet processed in Uniware',
  [Stage.PROCESSED]: 'Processed in Uniware, back in inventory',
  [Stage.CANCELLED]: 'Return cancelled in Uniware',
};
