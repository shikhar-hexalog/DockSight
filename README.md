# Returns Copilot · HexaBuild

AI-assisted RTO/DTO returns desk for the Hexalog warehouse.

```
shared/   types and constants used by both sides
server/   Node + Express API, SQLite database, Uniware sync
web/      React + Vite + Tailwind + shadcn/ui control tower
```

## Run it

```bash
npm install
npm run dev
```

- App: http://localhost:5180 (Receive desk at /receive, for a desktop with a USB barcode scanner)
- API: http://localhost:4000/api

With no Uniware account in `.env`, the app runs on built-in mock data, so everything works offline and before access is granted.

## Connect to Uniware

Each Uniware login is one block in `.env`, using the same naming as the reporting service:

```
UNICOMMERCE_ACCOUNT_A_TENANT=      # the part before .unicommerce.com
UNICOMMERCE_ACCOUNT_A_FACILITY=    # facility code, sent as the Facility header
UNICOMMERCE_ACCOUNT_A_USERNAME=
UNICOMMERCE_ACCOUNT_A_PASSWORD=
```

Add as many as needed (`_B_`, `_NEWME_`, ...). An account with only some values filled in is skipped, and the server log and Sync page name what's missing. An optional `UNICOMMERCE_ACCOUNT_<KEY>_BASE_URL` overrides `https://<tenant>.unicommerce.com`.

```bash
npm run db:reset       # drop mock data
npm run dev            # first start backfills each account
```

The app only calls `oauth/token`, `return/search` and `return/get`. It never writes to Uniware. Accounts sync one after another and independently; one failing doesn't stop the others.

## Database

SQLite through Node's built-in `node:sqlite`: one file at `data/hexabuild.db`, no server to install.

- Migrations live in `server/src/db/migrations/` and run automatically on start, in name order. To change the schema, add `002_<name>.sql`; never edit an applied file.
- `npm run db:reset` deletes the database; the next start rebuilds and re-syncs it.
- Tables:
  - `returns`, `return_items`: Uniware's fields, plus our own `stage`
  - `events`: append-only history; `client_action_id` makes offline phone actions idempotent
  - `sync_runs`, `sync_cursors`: sync history and how far incremental sync has read

The SQL is plain and portable, so moving to Postgres later is a driver change, not a redesign.

## How sync works

1. **Backfill** on first start: every return created in the last `BACKFILL_DAYS`.
2. **Incremental** every `SYNC_INTERVAL_MIN`: returns updated since the cursor, with a 10-minute overlap. A cursor only advances when its whole window succeeded.
3. **Lookup** on a scan miss: `GET /api/lookup/:code` checks our database, then asks Uniware for that one return.

Uniware stays the source of truth for its fields. Our `stage` only moves forward: a sync never undoes progress made on the floor.

`npm run sync` runs one sync from the terminal (`npm run sync -- backfill` to reload history).

## What the app tracks

```
Uniware: return expected  →  received at the dock  →  processed in Uniware
                             (scanned at /receive)    (detected by sync)
                                      └──── pending: the gap we measure ────┘
```

- **Received** = our dock scan, else the courier's delivery date from Uniware (for returns from before the desk was used).
- **Processed** = the first Uniware date showing it's back in inventory (inventory received or return completed). This is an assumption to confirm with the warehouse; it lives in one function, `processedAt()` in `server/src/uniware/mapper.ts`.
- **TAT** = processed minus received.

### Two clocks

Waiting time and TAT can be read on **working hours** (default) or **all hours**, switched from the page headers. Working hours count only `WORK_HOURS` on `WORK_DAYS`, minus `HOLIDAYS`, so a parcel arriving at 17:45 starts waiting the next morning. Default: 10:00–18:00, all seven days. The clock applies to the warehouse's own waiting (received, not yet processed); time with the courier always runs. Late = more than one working day (8 working hours) on the working clock, 24h on all hours. The logic is in `shared/src/workingTime.ts`, shared by server and screens; the AI briefs use working hours too.

## Receiving desk and offline

The desk keeps its own copy of every expected return (IndexedDB) and an outbox of scans.

- A scan is answered instantly from that copy, using the same `classifyScan()` the server uses (`shared/src/receiving.ts`), then sent to `POST /api/desk/scans` in the background.
- Each scan has an id made at the desk; the server stores each id once, so retries never double-count.
- If the network drops, scanning carries on; scans sync by themselves when it's back.
- An unknown code is looked up in Uniware before being called unexpected.
- Unexpected and cancelled-return parcels go to **Set aside** until someone resolves them with a note.

## Dispatch (with the cancellation guard)

Orders cancelled after their parcel was manifested, before the courier picked it up, become RTOs if nobody notices. Every `GUARD_INTERVAL_MIN` (default 2) the server asks each Uniware account for orders cancelled since the last check (`saleOrder/search` with `updatedSinceInMinutes`, then `saleorder/get`).

- A cancelled package that is on a manifest and wasn't dispatched before the cancellation becomes an **open hold**: pull it out.
- At the handover check (`/dispatch`), scanning a held AWB shows **STOP** and marks it pulled. Anything else only turns green once the server confirms; offline, it shows an amber "based on the last known holds".
- If Uniware later shows a held package dispatched, the hold becomes **missed**: an RTO is coming.
- Read-only: the app never changes Uniware.

## AI

AI runs through the Claude Code CLI on the server machine (`claude -p`, the logged-in subscription; no API key). Set `AI_PROVIDER=mock` to run without it. Start the server from a normal terminal, not from inside a Claude Code session, or the CLI refuses to run.

- **Briefs & questions** (`/ai`): a daily brief and shift handover notes, written at `BRIEF_DAILY_AT` / `BRIEF_HANDOVER_AT` and optionally posted to `BRIEF_WEBHOOK_URL`; and questions answered in plain words. The AI sees only a compact snapshot of the app's own data (`server/src/ai/snapshot.ts`), never customer details.
- **Damaged-label fallback** (Receive page): a webcam photo or upload of the label; the AI lists the codes it can read, and each is checked against expected returns before anyone uses it. The webcam needs the page opened on the same computer (localhost).
- Calls run one at a time and take roughly 20–60 seconds.

## Reports and exports

- `GET /api/overview`, `GET /api/reports/tat?days=14`
- `GET /api/export/pending.csv`: everything received but not processed, oldest first
- `GET /api/export/scans.csv?since=<iso>`: every dock scan with its result
