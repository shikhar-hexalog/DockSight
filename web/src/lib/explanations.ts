// Plain-language explanations for every number on Overview and Reports,
// shown as tooltips. Kept in one place so the wording stays consistent.

const TIME_NOTE = 'Counted in working hours (shift time only) or all hours, as chosen at the top right.';

export const EXPLAIN = {
  // Overview tiles
  expected:
    "Returns Uniware says are on their way back (RTO + DTO) that haven't reached our dock yet. One moves to Pending in Uniware once it's scanned at the receiving desk or listed in the receiving sheet.",
  receivedToday:
    'Returns that arrived at our dock today: scanned at the receiving desk, or listed in an imported receiving sheet. Each return counts once, at its first scan.',
  processedToday:
    'Returns Uniware marked as processed today (inventory received or return completed). Includes returns that arrived at the dock on earlier days.',
  pending:
    "At our dock but not yet processed in Uniware: the backlog to clear. 'Carried over' are the ones that arrived before today and are still waiting.",
  setAside:
    "Parcels scanned at the dock that need someone to check them: not in Uniware's expected list, or the return was already cancelled in Uniware. They leave this count once resolved on the Set aside page.",
  medianTat: `For returns processed in Uniware today: the typical time from arriving at our dock to being processed. Half were faster than this. Only returns with a dock arrival record count. ${TIME_NOTE}`,
  pullFromDispatch:
    "Outbound parcels whose order was cancelled after they were put on a courier manifest. Pull them out before the courier takes them, or they'll come back as RTOs. 'RTOs avoided' = pulled out today.",
  handoversToSign:
    "Receiving or dispatch handovers that are still open: the signed handover sheet hasn't been uploaded yet. Ones open for more than 2 hours are flagged.",
  shiftBrief: 'An AI-written summary for the shift change, made from the live numbers. Click to read the full note.',

  // Overview panels
  pendingAges: `Every return in Pending in Uniware, grouped by how long it has been at our dock without being processed. Over 1 working day counts as late. ${TIME_NOTE}`,
  pendingByCourier:
    'Pending returns grouped by the courier that brought them back, with the longest current wait for each. Shows whose parcels are piling up at the dock.',

  // Reports
  movements:
    'What changed status each day for the chosen client and period, and how many parcels were still waiting for Uniware at the end of each day. Click any number for the returns behind it.',
  movementCreated: 'Returns created in Uniware that day: new expected returns.',
  movementArrived: 'Returns that reached our dock that day: scanned at the desk or listed in the receiving sheet.',
  movementProcessed:
    "Returns processed in Uniware that day. 'No dock record' = processed without ever being scanned or listed at our dock, so their turnaround can't be measured.",
  movementCancelled: 'Returns cancelled in Uniware that day (mostly customer pickups that never happened).',
  pendingAtClose:
    'At our dock and still not processed in Uniware at midnight that day: the backlog carried into the next morning. If this keeps rising, processing is falling behind.',
  inward:
    "Reports are by inward date: the day a parcel reached our dock (scanned at the desk or listed in the receiving sheet). Each row follows that day's parcels through to Uniware. Click any number for the returns behind it.",
  inwardCameIn: 'Parcels that reached our dock that day.',
  inwardProcessed: 'Of the parcels that came in that day, how many Uniware has processed so far.',
  inwardPending: 'Of the parcels that came in that day, how many are still waiting to be processed in Uniware.',
  putawayPending:
    "Processed in Uniware, but the putaway isn't closed yet: the stock isn't back in inventory. Uniware's 'inventory received' date marks putaway closed.",
  legInwardProcessed: `Inward (reached our dock) to processed in Uniware (return completed). ${TIME_NOTE}`,
  legProcessedPutaway: `Processed in Uniware to putaway closed (inventory received: stock back). ${TIME_NOTE}`,
  legInwardPutaway: `The whole warehouse time: inward to putaway closed. ${TIME_NOTE}`,
  dispatch:
    "Per day at dispatch: courier pickups, parcels handed over after passing the cancellation check, cancelled orders caught, how many were pulled out (RTOs avoided) or handed over anyway (they'll come back as RTOs), and pickups where the rider's count didn't match ours.",
  volume: 'For each inward date: of the parcels that came in that day, how many are processed in Uniware and how many are still waiting.',
  tat: `For the parcels that came in each day: time from arriving at our dock to being processed in Uniware (only the ones processed so far). Median = half were faster. Slowest 1 in 10 = 90% were faster than this. ${TIME_NOTE}`,
  tatByCourier:
    "Parcels that came in during the period, grouped by the courier that brought them: how many, how many are still pending, and the dock-to-Uniware time. It measures our warehouse's speed on each courier's parcels, not the courier's delivery speed.",
  daily: 'The exact numbers behind the charts above, newest day first.',
} as const;
