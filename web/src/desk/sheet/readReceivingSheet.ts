// Reads the warehouse's receiving sheet (.xlsx or .csv) into rows for import.
// Columns: DATE, Received Time, Vehicle No, AWB#, Courier, TYPE, Remarks,
// found by name in the first rows (a title row above them is fine).
// Dates are read day-first, as written in India: 14/10/2026.

import { readSheet } from 'read-excel-file/browser';

import { SHEET_COLUMNS, type SheetColumn, type SheetProblem, type SheetRow, parseCsv } from '@hexabuild/shared';

// How far down to look for the header row.
const HEADER_SEARCH_ROWS = 15;

/** A row without a time is counted from the start of the working day. */
const DEFAULT_TIME = { hours: 10, minutes: 0 };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

type Cell = unknown;

interface DayParts {
  year: number;
  month: number;
  day: number;
}

interface TimeParts {
  hours: number;
  minutes: number;
}

export interface ReadSheetResult {
  rows: SheetRow[];
  problems: SheetProblem[];
  /** Rows given the default time because the time cell was empty. */
  defaultTimeCount: number;
}

const headerKey = (value: Cell) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function findHeader(rows: Cell[][]): { index: number; columns: Partial<Record<SheetColumn, number>> } | null {
  for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index++) {
    const keys = rows[index].map(headerKey);

    const columns: Partial<Record<SheetColumn, number>> = {};

    for (const [column, names] of Object.entries(SHEET_COLUMNS) as [SheetColumn, readonly string[]][]) {
      const at = keys.findIndex(key => names.includes(key));

      if (at >= 0) {
        columns[column] = at;
      }
    }

    if (columns.AWB !== undefined && columns.DATE !== undefined) {
      return { index, columns };
    }
  }

  return null;
}

const fullYear = (year: number) => (year < 100 ? 2000 + year : year);

function validDay(parts: DayParts): DayParts | null {
  const { year, month, day } = parts;

  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 ? parts : null;
}

function parseDay(value: Cell): DayParts | null {
  // Excel date cells arrive as Date objects at UTC midnight.
  if (value instanceof Date) {
    return validDay({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() });
  }

  const text = String(value ?? '')
    .trim()
    .split(/\s+/)[0];

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);

  if (iso) {
    return validDay({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) });
  }

  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);

  if (dayFirst) {
    return validDay({ year: fullYear(Number(dayFirst[3])), month: Number(dayFirst[2]), day: Number(dayFirst[1]) });
  }

  const named = /^(\d{1,2})[-/. ]?([a-z]{3})[a-z]*[-/. ]?(\d{2,4})$/i.exec(text);

  if (named) {
    return validDay({ year: fullYear(Number(named[3])), month: MONTHS.indexOf(named[2].toLowerCase()) + 1, day: Number(named[1]) });
  }

  return null;
}

function validTime(hours: number, minutes: number): TimeParts | null {
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? { hours, minutes } : null;
}

function parseTime(value: Cell): TimeParts | null {
  if (value instanceof Date) {
    return validTime(value.getUTCHours(), value.getUTCMinutes());
  }

  // Excel time as a fraction of a day: 0.4375 = 10:30.
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);

    return validTime(Math.floor(minutes / 60), minutes % 60);
  }

  const match = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(String(value ?? ''));

  if (!match) {
    return null;
  }

  let hours = Number(match[1]);

  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hours < 12) {
    hours += 12;
  }

  if (meridiem === 'am' && hours === 12) {
    hours = 0;
  }

  return validTime(hours, Number(match[2]));
}

/** Long AWB numbers in Excel come as numbers; never as 1.2E+13. */
function cellText(value: Cell): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim() || null;
}

function toRows(data: Cell[][]): ReadSheetResult {
  const header = findHeader(data);

  if (!header) {
    throw new Error('Could not find the header row. The sheet needs at least the DATE and AWB# columns.');
  }

  const { index, columns } = header;

  const at = (row: Cell[], column: SheetColumn) => (columns[column] === undefined ? null : row[columns[column]!]);

  const rows: SheetRow[] = [];

  const problems: SheetProblem[] = [];

  let defaultTimeCount = 0;

  data.slice(index + 1).forEach((row, offset) => {
    const line = index + offset + 2;

    const awb = cellText(at(row, 'AWB'))?.replace(/\s+/g, '') ?? null;

    if (!awb) {
      return;
    }

    const dateCell = at(row, 'DATE');

    const day = parseDay(dateCell);

    if (!day) {
      problems.push({ line, awb, reason: `Date not readable: "${cellText(dateCell) ?? ''}"` });
      return;
    }

    // A time can be in its own column, or after the date in the DATE cell.
    const time = parseTime(at(row, 'TIME')) ?? (typeof dateCell === 'string' ? parseTime(dateCell.split(/\s+/).slice(1).join(' ')) : null);

    if (!time) {
      defaultTimeCount++;
    }

    const { hours, minutes } = time ?? DEFAULT_TIME;

    const receivedAt = new Date(day.year, day.month - 1, day.day, hours, minutes);

    if (receivedAt.getTime() > Date.now() + 60 * 60 * 1000) {
      problems.push({ line, awb, reason: 'Date is in the future (is the day and month the right way round?)' });
      return;
    }

    rows.push({
      line,
      awb,
      receivedAt: receivedAt.toISOString(),
      vehicleNo: cellText(at(row, 'VEHICLE')),
      courier: cellText(at(row, 'COURIER')),
      type: cellText(at(row, 'TYPE')),
      remarks: cellText(at(row, 'REMARKS')),
    });
  });

  return { rows, problems, defaultTimeCount };
}

const CSV_EXTENSIONS = ['.csv', '.txt'];

export async function readReceivingSheet(file: File): Promise<ReadSheetResult> {
  const name = file.name.toLowerCase();

  if (CSV_EXTENSIONS.some(extension => name.endsWith(extension))) {
    return toRows(parseCsv(await file.text()));
  }

  return toRows((await readSheet(file)) as Cell[][]);
}
