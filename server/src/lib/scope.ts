// Client and date-range filters shared by the board and reports.

import { z } from 'zod';

import type { ScopeFilters } from '@hexabuild/shared';

import { DAY_MS } from './time.ts';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const scopeQuery = z.object({
  client: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.string().regex(DAY_PATTERN).optional(),
  to: z.string().regex(DAY_PATTERN).optional(),
});

/** Matches any code a person might have for a return, or its item. */
const SEARCH_SQL = `
  r.source_code LIKE :scopeQ OR r.sale_order_code LIKE :scopeQ OR r.tracking_number LIKE :scopeQ
  OR r.rto_tracking_number LIKE :scopeQ OR r.shipment_code LIKE :scopeQ OR r.reverse_pickup_code LIKE :scopeQ
  OR EXISTS (SELECT 1 FROM return_items i WHERE i.return_id = r.id AND (i.sku_code LIKE :scopeQ OR i.item_name LIKE :scopeQ))`;

/** Local midnight of a YYYY-MM-DD day. */
export function startOfLocalDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(year, month - 1, date);
}

/** [from, to) as instants: from the start of `from` to the end of `to`. */
export function scopeWindow(scope: ScopeFilters): { from?: string; to?: string } {
  return {
    from: scope.from ? startOfLocalDay(scope.from).toISOString() : undefined,
    to: scope.to ? new Date(startOfLocalDay(scope.to).getTime() + DAY_MS).toISOString() : undefined,
  };
}

/**
 * SQL conditions (each starting with AND) and their parameters for a scope.
 * `dateColumn` is the date the range applies to, or null for client only.
 */
export function scopeSql(scope: ScopeFilters, dateColumn: string | null): { sql: string; params: Record<string, string> } {
  const parts: string[] = [];

  const params: Record<string, string> = {};

  if (scope.client) {
    parts.push('AND r.account = :scopeClient');
    params.scopeClient = scope.client;
  }

  if (scope.q) {
    parts.push(`AND (${SEARCH_SQL})`);
    params.scopeQ = `%${scope.q}%`;
  }

  const window = scopeWindow(scope);

  if (dateColumn && window.from) {
    parts.push(`AND ${dateColumn} >= :scopeFrom`);
    params.scopeFrom = window.from;
  }

  if (dateColumn && window.to) {
    parts.push(`AND ${dateColumn} < :scopeTo`);
    params.scopeTo = window.to;
  }

  return { sql: parts.join(' '), params };
}
