// Loads Uniware export files when the API isn't available:
//   npm run import -- "~/Downloads/Courier Returns_14102026121939.csv"
// Re-importing a newer export updates returns in place.

import { readFileSync } from 'node:fs';

import { config } from '../config.ts';
import { migrate } from '../db/index.ts';
import { importCourierReturns } from '../import/courierReturns.ts';

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('Usage: npm run import -- <Courier Returns export .csv> [...]');
  process.exit(1);
}

migrate();

for (const file of files) {
  try {
    const result = importCourierReturns(config.uniware.importAccount, readFileSync(file, 'utf8'));

    console.log(`[import] ${file}: ${result.rows} rows, ${result.skipped} skipped`);

    console.table({ outcome: result.outcomes, stage: result.stages });
  } catch (err) {
    console.error(`[import] ${file}: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
