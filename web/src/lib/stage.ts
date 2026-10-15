import { Stage } from '@hexabuild/shared';

export const STAGE_HINT: Record<Stage, string> = {
  [Stage.EXPECTED]: 'Uniware expects it; not at the warehouse yet',
  [Stage.RECEIVED]: 'At our dock, not yet in Uniware',
  [Stage.MANIFESTED]: 'In Uniware (acknowledged / returned), putaway not closed',
  [Stage.CLOSED]: 'Putaway closed: stock back in inventory',
  [Stage.CANCELLED]: 'Return cancelled in Uniware',
};
