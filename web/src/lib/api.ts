import type {
  AiStatusResponse,
  ApiError,
  AskAnswer,
  BatchDetailResponse,
  BatchesResponse,
  ClientsResponse,
  DeskOp,
  DeskOpsResponse,
  DispatchReportResponse,
  MovementKind,
  MovementsResponse,
  ClockMode,
  DemoCancellationResponse,
  RemoteJoinResponse,
  SheetImportRequest,
  SheetImportResponse,
  RemoteResult,
  RemoteScan,
  RemoteScanResponse,
  RemoteSession,
  RemoteTarget,
  SettingsResponse,
  Brief,
  BriefKind,
  BriefsResponse,
  LabelReadResponse,
  DeskManifest,
  DispatchHold,
  DispatchHoldsResponse,
  GuardStatus,
  HandoverCheck,
  HandoverChecksResponse,
  OverviewResponse,
  PipelineResponse,
  Receipt,
  ReceiptsResponse,
  ReceiveResponse,
  ReceiveScan,
  ReturnDetail,
  ReturnSort,
  ReturnType,
  ReturnsListResponse,
  ScopeFilters,
  Stage,
  SyncKind,
  SyncStatusResponse,
  TatReportResponse,
} from '@hexabuild/shared';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  const body = (await res.json().catch(() => null)) as T | ApiError | null;

  if (!res.ok) {
    const message = (body as ApiError | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiRequestError(message, res.status);
  }

  return body as T;
}

export interface ReturnsFilters extends ScopeFilters {
  movement?: MovementKind;
  putawayPending?: boolean;
  stage?: Stage;
  type?: ReturnType;
  q?: string;
  sort?: ReturnSort;
  limit?: number;
}

export interface ReceiptsFilters {
  since?: string;
  exceptions?: boolean;
  open?: boolean;
  limit?: number;
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();

  return query === '' ? '' : `?${query}`;
}

// The desk can be offline for a while; give up quickly and let the outbox retry.
const DESK_TIMEOUT_MS = 10_000;

export const api = {
  settings: () => request<SettingsResponse>('/settings'),

  overview: (clock: ClockMode) => request<OverviewResponse>(`/overview${toQuery({ clock })}`),

  tatReport: (scope: ScopeFilters, clock: ClockMode) => request<TatReportResponse>(`/reports/tat${toQuery({ ...scope, clock })}`),

  clients: () => request<ClientsResponse>('/clients'),

  dispatchReport: (scope: ScopeFilters) => request<DispatchReportResponse>(`/reports/dispatch${toQuery({ ...scope })}`),

  movements: (scope: ScopeFilters) => request<MovementsResponse>(`/reports/movements${toQuery({ ...scope })}`),

  pipeline: (type: ReturnType | undefined, clock: ClockMode, scope: ScopeFilters = {}) =>
    request<PipelineResponse>(`/pipeline${toQuery({ type, clock, ...scope })}`),

  returns: (filters: ReturnsFilters) => request<ReturnsListResponse>(`/returns${toQuery({ ...filters })}`),

  returnDetail: (id: string) => request<ReturnDetail>(`/returns/${encodeURIComponent(id)}`),

  receipts: (filters: ReceiptsFilters) => request<ReceiptsResponse>(`/receipts${toQuery({ ...filters })}`),

  resolveReceipt: (id: string, resolvedBy: string, note: string) =>
    request<Receipt>(`/receipts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolvedBy, note }),
    }),

  deskManifest: () =>
    request<DeskManifest>('/desk/manifest', {
      signal: AbortSignal.timeout(DESK_TIMEOUT_MS),
    }),

  sendScans: (scans: ReceiveScan[]) =>
    request<ReceiveResponse>('/desk/scans', {
      method: 'POST',
      body: JSON.stringify({ scans }),
      signal: AbortSignal.timeout(DESK_TIMEOUT_MS * 3),
    }),

  holds: (since?: string) => request<DispatchHoldsResponse>(`/dispatch/holds${toQuery({ since })}`),

  pullHold: (id: string, pulledBy: string) =>
    request<DispatchHold>(`/dispatch/holds/${encodeURIComponent(id)}/pull`, {
      method: 'POST',
      body: JSON.stringify({ pulledBy }),
    }),

  sendHandoverChecks: (checks: HandoverCheck[]) =>
    request<HandoverChecksResponse>('/dispatch/checks', {
      method: 'POST',
      body: JSON.stringify({ checks }),
      signal: AbortSignal.timeout(DESK_TIMEOUT_MS),
    }),

  runGuard: () => request<GuardStatus>('/dispatch/guard/run', { method: 'POST' }),

  demoCancellation: () => request<DemoCancellationResponse>('/demo/cancellation', { method: 'POST' }),

  clearDemoCancellations: () => request<{ removed: number }>('/demo/cancellations', { method: 'DELETE' }),

  sendOps: (ops: DeskOp[]) => request<DeskOpsResponse>('/desk/ops', { method: 'POST', body: JSON.stringify({ ops }) }),

  batches: () => request<BatchesResponse>('/desk/batches'),

  batch: (id: string) => request<BatchDetailResponse>(`/desk/batches/${id}`),

  importSheet: (body: SheetImportRequest) =>
    request<SheetImportResponse>('/desk/sheet-import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createRemoteSession: (target: RemoteTarget) =>
    request<RemoteSession>('/remote/sessions', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),

  joinRemoteSession: (id: string) =>
    request<RemoteJoinResponse>(`/remote/sessions/${id}/join`, {
      method: 'POST',
    }),

  sendRemoteScan: (id: string, scan: RemoteScan) =>
    request<RemoteScanResponse>(`/remote/sessions/${id}/scans`, {
      method: 'POST',
      body: JSON.stringify(scan),
    }),

  sendRemoteResult: (id: string, result: RemoteResult) =>
    fetch(`/api/remote/sessions/${id}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    }),

  aiStatus: () => request<AiStatusResponse>('/ai/status'),

  briefs: (limit = 20) => request<BriefsResponse>(`/briefs${toQuery({ limit })}`),

  generateBrief: (kind: BriefKind) =>
    request<Brief>('/briefs', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),

  ask: (question: string) =>
    request<AskAnswer>('/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  readLabel: (mimeType: string, imageBase64: string) =>
    request<LabelReadResponse>('/desk/read-label', {
      method: 'POST',
      body: JSON.stringify({ mimeType, imageBase64 }),
    }),

  syncStatus: () => request<SyncStatusResponse>('/sync/status'),

  runSync: (kind: SyncKind) =>
    request<SyncStatusResponse>('/sync/run', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
};

/** Download links; the browser saves the CSV. */
export interface ExportRange {
  since: string;
  until: string;
}

export const exportUrls = {
  pending: '/api/export/pending.csv',
  scans: (since?: string, until?: string) => `/api/export/scans.csv${toQuery({ since, until })}`,
  handover: (range: ExportRange) => `/api/export/handover.csv${toQuery({ ...range })}`,
  holds: (range: ExportRange) => `/api/export/holds.csv${toQuery({ ...range })}`,
  returns: (filters: ScopeFilters & { movement?: MovementKind; stage?: Stage; putawayPending?: boolean }) =>
    `/api/export/returns.csv${toQuery({ ...filters })}`,
};
