import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BriefKind, ReturnType, ScopeFilters, SyncKind } from '@hexabuild/shared';

import { useClock } from '@/hooks/useClock';

import { type ReceiptsFilters, type ReturnsFilters, api } from '@/lib/api';

// Screens poll so scans at the dock and Uniware changes show up without a refresh.
const LIVE_REFRESH_MS = 5_000;

const REPORT_REFRESH_MS = 60_000;

const SYNC_RUNNING_REFRESH_MS = 1_500;

const SYNC_IDLE_REFRESH_MS = 10_000;

export const queryKeys = {
  overview: (clock: string) => ['overview', clock] as const,
  tat: (scope: ScopeFilters, clock: string) => ['tat', scope, clock] as const,
  pipeline: (type: ReturnType | undefined, clock: string, scope: ScopeFilters) => ['pipeline', type ?? 'all', clock, scope] as const,
  clients: ['clients'] as const,
  movements: (scope: ScopeFilters) => ['movements', scope] as const,
  dispatchReport: (scope: ScopeFilters) => ['dispatch-report', scope] as const,
  returns: (filters: ReturnsFilters) => ['returns', filters] as const,
  returnDetail: (id: string) => ['return', id] as const,
  receipts: (filters: ReceiptsFilters) => ['receipts', filters] as const,
  syncStatus: ['sync-status'] as const,
  holds: ['holds'] as const,
  aiStatus: ['ai-status'] as const,
  briefs: ['briefs'] as const,
  manifests: ['manifests'] as const,
  manifest: (id: string) => ['manifest', id] as const,
  qcRecent: ['qc-recent'] as const,
};

const BRIEFS_REFRESH_MS = 60_000;

export function useAiStatus() {
  return useQuery({ queryKey: queryKeys.aiStatus, queryFn: api.aiStatus });
}

export function useBriefs() {
  return useQuery({
    queryKey: queryKeys.briefs,
    queryFn: () => api.briefs(),
    refetchInterval: BRIEFS_REFRESH_MS,
  });
}

export function useGenerateBrief() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (kind: BriefKind) => api.generateBrief(kind),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.briefs });
    },
  });
}

export function useAsk() {
  return useMutation({ mutationFn: (question: string) => api.ask(question) });
}

export function useReadLabel() {
  return useMutation({
    mutationFn: ({ mimeType, imageBase64 }: { mimeType: string; imageBase64: string }) => api.readLabel(mimeType, imageBase64),
  });
}

// Holds can appear any minute before a courier pickup.
const HOLDS_REFRESH_MS = 10_000;

export function useHolds() {
  return useQuery({
    queryKey: queryKeys.holds,
    queryFn: () => api.holds(),
    refetchInterval: HOLDS_REFRESH_MS,
  });
}

export function usePullHold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, pulledBy }: { id: string; pulledBy: string }) => api.pullHold(id, pulledBy),
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useRunGuard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.runGuard,
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useOverview() {
  const { mode } = useClock();

  return useQuery({
    queryKey: queryKeys.overview(mode),
    queryFn: () => api.overview(mode),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useTatReport(scope: ScopeFilters) {
  const { mode } = useClock();

  return useQuery({
    queryKey: queryKeys.tat(scope, mode),
    queryFn: () => api.tatReport(scope, mode),
    refetchInterval: REPORT_REFRESH_MS,
    placeholderData: previous => previous,
  });
}

export function useClients() {
  return useQuery({
    queryKey: queryKeys.clients,
    queryFn: api.clients,
    staleTime: 5 * 60_000,
  });
}

export function usePipeline(type?: ReturnType, scope: ScopeFilters = {}) {
  const { mode } = useClock();

  return useQuery({
    queryKey: queryKeys.pipeline(type, mode, scope),
    queryFn: () => api.pipeline(type, mode, scope),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useReturns(filters: ReturnsFilters) {
  return useQuery({
    queryKey: queryKeys.returns(filters),
    queryFn: () => api.returns(filters),
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: previous => previous,
  });
}

export function useReturnDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.returnDetail(id ?? ''),
    queryFn: () => api.returnDetail(id ?? ''),
    enabled: id !== null,
  });
}

export function useReceipts(filters: ReceiptsFilters) {
  return useQuery({
    queryKey: queryKeys.receipts(filters),
    queryFn: () => api.receipts(filters),
    refetchInterval: LIVE_REFRESH_MS,
    placeholderData: previous => previous,
  });
}

export function useResolveReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, resolvedBy, note }: { id: string; resolvedBy: string; note: string }) => api.resolveReceipt(id, resolvedBy, note),
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useSyncStatus() {
  return useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: api.syncStatus,
    refetchInterval: query => (query.state.data?.running ? SYNC_RUNNING_REFRESH_MS : SYNC_IDLE_REFRESH_MS),
  });
}

export function useRunSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (kind: SyncKind) => api.runSync(kind),
    onSuccess: status => {
      queryClient.setQueryData(queryKeys.syncStatus, status);
    },
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
}

/** Stages a cancelled-after-manifest order, then refreshes holds so the desk knows at once. */
export function useDemoCancellation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.demoCancellation,
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useClearDemoCancellations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearDemoCancellations,
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useMovements(scope: ScopeFilters) {
  return useQuery({
    queryKey: queryKeys.movements(scope),
    queryFn: () => api.movements(scope),
    refetchInterval: REPORT_REFRESH_MS,
    placeholderData: previous => previous,
  });
}

export function useDispatchReport(scope: ScopeFilters) {
  return useQuery({
    queryKey: queryKeys.dispatchReport(scope),
    queryFn: () => api.dispatchReport(scope),
    refetchInterval: REPORT_REFRESH_MS,
    placeholderData: previous => previous,
  });
}

export function useManifests() {
  return useQuery({ queryKey: queryKeys.manifests, queryFn: api.manifests, refetchInterval: LIVE_REFRESH_MS });
}

export function useManifest(id: string | null) {
  return useQuery({
    queryKey: queryKeys.manifest(id ?? ''),
    queryFn: () => api.manifest(id!),
    enabled: id !== null,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useQcRecent() {
  return useQuery({ queryKey: queryKeys.qcRecent, queryFn: api.qcRecent, refetchInterval: LIVE_REFRESH_MS });
}

export function useQcLookup() {
  return useMutation({ mutationFn: api.qcLookup });
}

export function useSubmitQc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.submitQc,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.qcRecent });

      void queryClient.invalidateQueries({ queryKey: ['manifest'] });
    },
  });
}

export function useQcCheck() {
  return useMutation({ mutationFn: ({ returnId, photo }: { returnId: string; photo: string }) => api.qcCheck(returnId, photo) });
}
