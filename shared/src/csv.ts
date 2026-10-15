// Minimal RFC 4180 CSV reader: quoted fields, escaped quotes, commas and
// line breaks inside quotes. Uniware exports need nothing more.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];

  let row: string[] = [];

  let field = '';

  let quoted = false;

  // Strip a UTF-8 byte order mark.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') {
        i++;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Blank rows are kept so row numbers match the file.
  return rows;
}

/** Rows as objects keyed by header name. */
export function csvRecords(text: string): { header: string[]; records: Record<string, string>[] } {
  const [header = [], ...rows] = parseCsv(text);

  const records = rows
    .filter(row => row.some(cell => cell.trim() !== ''))
    .map(row => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ''])));

  return { header, records };
}
