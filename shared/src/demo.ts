// Demo support: stage a cancelled-after-manifest order so the dispatch STOP
// can be shown on cue, when there's no real one at that moment.

export interface DemoCancellationResponse {
  code: string;
}

/** Holds made by "Simulate a cancellation" are stored under this account. */
export const DEMO_ACCOUNT = 'DEMO';
