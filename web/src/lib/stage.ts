import { Stage } from '@hexabuild/shared';

/** Tailwind classes for each stage's colour dot. */
export const STAGE_DOT_CLASS: Record<Stage, string> = {
  [Stage.EXPECTED]: 'bg-stage-expected',
  [Stage.RECEIVED]: 'bg-stage-pending',
  [Stage.MANIFESTED]: 'bg-stage-manifested',
  [Stage.CLOSED]: 'bg-stage-processed',
  [Stage.CANCELLED]: 'bg-stage-cancelled',
};

export const STAGE_HINT: Record<Stage, string> = {
  [Stage.EXPECTED]: 'Uniware expects it; not at the warehouse yet',
  [Stage.RECEIVED]: 'At our dock, not yet in Uniware',
  [Stage.MANIFESTED]: 'In Uniware (acknowledged / returned), putaway not closed',
  [Stage.CLOSED]: 'Putaway closed: stock back in inventory',
  [Stage.CANCELLED]: 'Return cancelled in Uniware',
};
