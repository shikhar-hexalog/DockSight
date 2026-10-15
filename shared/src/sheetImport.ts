// Importing the warehouse's receiving sheet (the Google Sheet the dock used
// before the desk): each row is a parcel that physically arrived, with its
// arrival time. Rows go through the same matching as a desk scan, so a sheet
// row and a scan of the same AWB are treated alike.

/** Column names in the sheet, matched ignoring case, spaces and punctuation. */
export const SHEET_COLUMNS = {
  DATE: ['date'],
  TIME: ['receivedtime', 'time'],
  VEHICLE: ['vehicleno', 'vehiclenumber', 'vehicle'],
  AWB: ['awb', 'awbno', 'awbnumber', 'trackingno', 'trackingnumber'],
  COURIER: ['courier', 'couriername'],
  TYPE: ['type'],
  REMARKS: ['remarks', 'remark', 'notes'],
} as const;

export type SheetColumn = keyof typeof SHEET_COLUMNS;

/** One sheet row, already read from the file. */
export interface SheetRow {
  /** Row number in the file, for messages. */
  line: number;
  awb: string;
  /** Arrival time (ISO), from DATE + Received Time. */
  receivedAt: string;
  vehicleNo: string | null;
  courier: string | null;
  type: string | null;
  remarks: string | null;
}

/** A row the file reader couldn't use. */
export interface SheetProblem {
  line: number;
  awb: string | null;
  reason: string;
}

/** What importing a row does. */
export const SheetOutcome = {
  /** An expected return: now Pending in Uniware. */
  RECEIVED: 'RECEIVED',
  /** Uniware already processed it: the dock time is kept, for turnaround reports. */
  PROCESSED_TIME_RECORDED: 'PROCESSED_TIME_RECORDED',
  /** We already had a dock time for it (a desk scan or an earlier import). */
  ALREADY_RECEIVED: 'ALREADY_RECEIVED',
  /** Uniware cancelled the return, but the parcel came: set aside. */
  CANCELLED_RETURN: 'CANCELLED_RETURN',
  /** No return in Uniware has this AWB: set aside. */
  NOT_FOUND: 'NOT_FOUND',
  /** This exact row was imported before: nothing changes. */
  DUPLICATE: 'DUPLICATE',
} as const;

export type SheetOutcome = (typeof SheetOutcome)[keyof typeof SheetOutcome];

export const SHEET_OUTCOME_LABEL: Record<SheetOutcome, string> = {
  [SheetOutcome.RECEIVED]: 'Expected, now Pending in Uniware',
  [SheetOutcome.PROCESSED_TIME_RECORDED]: 'Already processed in Uniware (dock time saved for turnaround)',
  [SheetOutcome.ALREADY_RECEIVED]: 'Already received earlier',
  [SheetOutcome.CANCELLED_RETURN]: 'Return was cancelled in Uniware: set aside',
  [SheetOutcome.NOT_FOUND]: 'Not found in Uniware: set aside',
  [SheetOutcome.DUPLICATE]: 'Imported before, skipped',
};

export interface SheetImportRequest {
  rows: SheetRow[];
  importedBy: string;
  /** Work out what would happen, without saving anything. */
  dryRun: boolean;
}

export interface SheetImportResponse {
  dryRun: boolean;
  total: number;
  counts: Record<SheetOutcome, number>;
  /** A few AWBs per outcome, to show in the preview. */
  examples: Partial<Record<SheetOutcome, string[]>>;
}
