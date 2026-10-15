// Which date column each status change is counted on, for the movements
// report and its drill-down lists.

import { MovementKind, Stage } from '@hexabuild/shared';

/** The date each movement happened on. */
export const MOVEMENT_DATE_SQL: Record<MovementKind, string> = {
  [MovementKind.CREATED]: 'r.source_created_at',
  [MovementKind.ARRIVED]: 'r.dock_received_at',
  [MovementKind.PROCESSED]: 'r.processed_at',
  [MovementKind.CANCELLED]: 'r.stage_changed_at',
};

/** Extra condition for a movement, beyond its date. */
export const MOVEMENT_WHERE_SQL: Record<MovementKind, string> = {
  [MovementKind.CREATED]: '',
  [MovementKind.ARRIVED]: '',
  [MovementKind.PROCESSED]: '',
  [MovementKind.CANCELLED]: `AND r.stage = '${Stage.CANCELLED}'`,
};
