/**
 * Typed react-query hooks for every endpoint the web app uses.
 * Response types come from @sahay/shared zod schemas — the server is built to the same contract.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AuthSession,
  Category,
  EventDashboard,
  EventDetail,
  EventSummary,
  InventoryItem,
  MatchView,
  Me,
  Message,
  Notification,
  OfferView,
  RequestView,
} from '@sahay/shared';
import {
  zAdminReportView,
  zAdminUserView,
  zAvailability,
  zBringSuggestion,
  zConversationView,
  zDataExport,
  zFeatureFlag,
  zNotificationPrefs,
  zReportView,
  zSessionInfo,
} from '@sahay/shared';
import type { z } from 'zod';
import { api, getToken } from './client';

export type SessionInfo = z.infer<typeof zSessionInfo>;
export type Availability = z.infer<typeof zAvailability>;
export type BringSuggestion = z.infer<typeof zBringSuggestion>;
export type ConversationView = z.infer<typeof zConversationView>;
export type NotificationPrefs = z.infer<typeof zNotificationPrefs>;
export type DataExport = z.infer<typeof zDataExport>;
export type ReportView = z.infer<typeof zReportView>;
export type AdminReportView = z.infer<typeof zAdminReportView>;
export type AdminUserView = z.infer<typeof zAdminUserView>;
export type FeatureFlag = z.infer<typeof zFeatureFlag>;

/* -------------------------------------------------------------------- auth */

export function useMe(enabled = true): UseQueryResult<Me> {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
    enabled: enabled && !!getToken(),
    staleTime: 60_000,
  });
}

export function useOtpStart() {
  return useMutation({
    mutationFn: (body: { email: string; locale: 'en' | 'hi' }) =>
      api<{ ok: boolean; retryAfterSeconds: number }>('/auth/otp/start', { body }),
  });
}

export function useOtpVerify() {
  return useMutation({
    mutationFn: (body: { email: string; code: string; device: { platform: 'web'; name?: string } }) =>
      api<AuthSession>('/auth/otp/verify', { body }),
  });
}

export function useLogout() {
  return useMutation({ mutationFn: () => api<{ ok: boolean }>('/auth/logout', { method: 'POST', body: {} }) });
}

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfo[]>('/auth/sessions') });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { locale?: 'en' | 'hi'; regeneratePseudonym?: boolean }) =>
      api<Me>('/me', { method: 'PATCH', body }),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  });
}

/* ------------------------------------------------------------------ events */

export interface EventSearchParams {
  q?: string;
  type?: string;
  cursor?: string;
}

export function useEvents(params: EventSearchParams) {
  return useQuery({
    queryKey: ['events', params],
    queryFn: () =>
      api<{ items: EventSummary[]; nextCursor?: string | null }>('/events', {
        query: { q: params.q, type: params.type, cursor: params.cursor },
      }),
  });
}

export function useEvent(idOrCode: string | undefined) {
  return useQuery({
    queryKey: ['event', idOrCode],
    queryFn: () => api<EventDetail>(`/events/${encodeURIComponent(idOrCode ?? '')}`),
    enabled: !!idOrCode,
  });
}

export interface CreateEventBody {
  title: string;
  description: string;
  type: string;
  visibility: 'public' | 'unlisted' | 'invite_only';
  areaLabel: string;
  center: { lat: number; lng: number };
  radiusM: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  safetyInfo?: string;
  medicalInfo?: string;
}

/** POST /events responds {event, inviteCode?} — the invite code is issued exactly once, here. */
export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEventBody) => api<{ event: EventDetail; inviteCode?: string }>('/events', { body }),
    onSuccess: ({ event }) => {
      qc.setQueryData(['event', event.id], event);
      qc.setQueryData(['event', event.code], event);
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function useJoinEvent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { inviteCode?: string }) => api<EventDetail>(`/events/${eventId}/join`, { body }),
    onSuccess: (detail) => {
      qc.setQueryData(['event', detail.id], detail);
      qc.setQueryData(['event', detail.code], detail);
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function useLeaveEvent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean }>(`/events/${eventId}/leave`, { method: 'POST', body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['event'] });
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useEventDashboard(eventId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', eventId],
    queryFn: () => api<EventDashboard>(`/events/${eventId}/dashboard`),
    enabled: !!eventId,
    refetchInterval: 60_000,
  });
}

export function useBringSuggestions(eventId: string | undefined, isMember: boolean) {
  return useQuery({
    queryKey: ['bring', eventId],
    queryFn: () => api<{ suggestions: BringSuggestion[] }>(`/events/${eventId}/bring`),
    enabled: !!eventId && isMember,
  });
}

/* --------------------------------------------------------------- catalogue */

export function useCatalogue() {
  return useQuery({
    queryKey: ['catalogue'],
    queryFn: () => api<{ categories: Category[] }>('/catalogue'),
    staleTime: 10 * 60_000,
  });
}

/* --------------------------------------------------------------- inventory */

export function useInventory(eventId: string | undefined, isMember = true) {
  return useQuery({
    queryKey: ['inventory', eventId],
    queryFn: () => api<{ items: InventoryItem[] }>(`/events/${eventId}/inventory`),
    enabled: !!eventId && isMember,
  });
}

export interface AddInventoryBody {
  categoryId: string;
  qty: number;
  unit: string;
  details: Record<string, unknown>;
  idempotencyKey?: string;
}

export function useAddInventory(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddInventoryBody) => api<InventoryItem>(`/events/${eventId}/inventory`, { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory', eventId] }),
  });
}

export function useUpdateInventory(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...body }: { itemId: string; qtyTotal?: number; active?: boolean; details?: Record<string, unknown> }) =>
      api<InventoryItem>(`/inventory/${itemId}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory', eventId] }),
  });
}

export function useDeleteInventory(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api<{ ok: boolean }>(`/inventory/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory', eventId] }),
  });
}

/* --------------------------------------------------- availability/location */

export function useAvailability(eventId: string | undefined) {
  return useQuery({
    queryKey: ['availability', eventId],
    queryFn: () => api<Availability>(`/events/${eventId}/availability`),
    enabled: !!eventId,
  });
}

export function useSetAvailability(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { on: boolean; durationMinutes?: 30 | 60 | 120; untilEventEnd?: boolean }) =>
      api<Availability>(`/events/${eventId}/availability`, { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(['availability', eventId], data),
  });
}

export function pingLocation(eventId: string, coords: { lat: number; lng: number }) {
  return api<{ ok: boolean; expiresAt: string }>(`/events/${eventId}/location`, {
    method: 'PUT',
    body: { coords },
  });
}

export function deleteLocation(eventId: string) {
  return api<{ ok: boolean }>(`/events/${eventId}/location`, { method: 'DELETE' });
}

/* ---------------------------------------------------------------- requests */

export interface CreateRequestBody {
  eventId: string;
  categoryId: string;
  qty: number;
  unit: string;
  urgency: 'standard' | 'soon' | 'urgent';
  note?: string;
  expiresInMinutes: number;
  coords?: { lat: number; lng: number };
  areaHint?: string;
  safetyAcknowledged: true;
  idempotencyKey: string;
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRequestBody) => api<RequestView>('/requests', { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['requests'] }),
  });
}

export function useMyRequests(eventId?: string) {
  return useQuery({
    queryKey: ['requests', eventId ?? 'all'],
    queryFn: () => api<{ items: RequestView[] }>('/requests/mine', { query: { eventId } }),
    enabled: !!getToken(),
  });
}

export function useRequest(id: string | undefined, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['request', id],
    queryFn: () => api<RequestView>(`/requests/${id}`),
    enabled: !!id,
    refetchInterval: opts?.refetchInterval,
  });
}

function useRequestAction(path: (id: string) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: unknown }) =>
      api<RequestView>(path(id), { method: 'POST', body: body ?? {} }),
    onSuccess: (view) => {
      qc.setQueryData(['request', view.id], view);
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}

export function useCancelRequest() {
  return useRequestAction((id) => `/requests/${id}/cancel`);
}
export function useRenewRequest() {
  return useRequestAction((id) => `/requests/${id}/renew`);
}
export function useContinueRequest() {
  return useRequestAction((id) => `/requests/${id}/continue`);
}

/* ------------------------------------------------------------------ offers */

export function usePendingOffers(enabled = true) {
  return useQuery({
    queryKey: ['offers'],
    queryFn: () => api<{ items: OfferView[] }>('/offers/pending'),
    enabled: enabled && !!getToken(),
    refetchInterval: 30_000,
  });
}

export function useRespondOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accept, alsoStopReceiving }: { id: string; accept: boolean; alsoStopReceiving?: boolean }) =>
      api<{ offer: OfferView; match?: MatchView }>(`/offers/${id}/respond`, {
        body: { accept, alsoStopReceiving: alsoStopReceiving ?? false },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offers'] });
      void qc.invalidateQueries({ queryKey: ['matches'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

/* ----------------------------------------------------------------- matches */

export function useActiveMatches(enabled = true) {
  return useQuery({
    queryKey: ['matches'],
    queryFn: () => api<{ items: MatchView[] }>('/matches/active'),
    enabled: enabled && !!getToken(),
  });
}

export function useMatch(id: string | undefined, opts?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ['match', id],
    queryFn: () => api<MatchView>(`/matches/${id}`),
    enabled: !!id,
    refetchInterval: opts?.refetchInterval ?? false,
  });
}

function useMatchAction<TBody>(path: (id: string) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TBody }) =>
      api<MatchView>(path(id), { method: 'POST', body }),
    onSuccess: (view) => {
      qc.setQueryData(['match', view.id], view);
      void qc.invalidateQueries({ queryKey: ['matches'] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      // Cancel/confirm can close the conversation server-side (e.g. an
      // 'unsafe' cancel flips it readonly immediately) — refresh it so the
      // chat UI locks right away instead of serving a stale 'open' status.
      void qc.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
}

export function useMeetingUpdate() {
  return useMatchAction<{ state: string }>((id) => `/matches/${id}/meeting`);
}
export function useCancelMatch() {
  return useMatchAction<{ reason: string; note?: string }>((id) => `/matches/${id}/cancel`);
}
export function useConfirmCompletion() {
  return useMatchAction<{ qty: number; idempotencyKey: string }>((id) => `/matches/${id}/confirm`);
}

/* -------------------------------------------------------------------- chat */

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api<ConversationView>(`/conversations/${id}`),
    enabled: !!id,
  });
}

export function useMessages(id: string | undefined, pollMs: number | false) {
  return useQuery({
    queryKey: ['conversation', id, 'messages'],
    queryFn: () => api<{ items: Message[]; nextCursor?: string | null }>(`/conversations/${id}/messages`, {
      query: { limit: 100 },
    }),
    enabled: !!id,
    refetchInterval: pollMs,
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    // react-query's default networkMode pauses mutations while offline, which
    // would leave a chat bubble on "Sending…" forever. Fire anyway so the send
    // fails fast and the explicit "Not sent — tap to retry" affordance appears
    // (retries are safe: sends are idempotent via clientMsgId).
    networkMode: 'always',
    mutationFn: (body: { kind: 'text' | 'quick'; body: string; clientMsgId: string }) =>
      api<Message>(`/conversations/${conversationId}/messages`, { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'messages'] }),
  });
}

export function markConversationRead(conversationId: string) {
  return api<{ ok: boolean }>(`/conversations/${conversationId}/read`, { method: 'POST', body: {} });
}

/* ------------------------------------------------------------------ safety */

export interface CreateReportBody {
  category: string;
  note?: string;
  matchId?: string;
  eventId?: string;
  preserveConversation: boolean;
}

export function useCreateReport() {
  return useMutation({ mutationFn: (body: CreateReportBody) => api<ReportView>('/reports', { body }) });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { matchId: string }) => api<{ ok: boolean }>('/blocks', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['matches'] });
      void qc.invalidateQueries({ queryKey: ['blocks'] });
    },
  });
}

export function useBlocks() {
  return useQuery({
    queryKey: ['blocks'],
    queryFn: () => api<{ blocks: { createdAt: string; alias: string }[] }>('/me/blocks'),
  });
}

/* ---------------------------------------------------------- notifications */

/** zRegisterPush — token is the JSON-serialized PushSubscription for provider 'webpush'. */
export function registerPushToken(token: string) {
  return api<{ ok: boolean }>('/me/push-tokens', { body: { provider: 'webpush', token } });
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: ['notificationPrefs'],
    queryFn: () => api<NotificationPrefs>('/me/notification-prefs'),
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPrefs) => api<NotificationPrefs>('/me/notification-prefs', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(['notificationPrefs'], data),
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Notification[]; nextCursor?: string | null }>('/me/notifications'),
    enabled: enabled && !!getToken(),
  });
}

/* ------------------------------------------------------- privacy & account */

export function useConsents() {
  return useQuery({
    queryKey: ['consents'],
    queryFn: () => api<{ items: { kind: string; granted: boolean; createdAt: string }[] }>('/me/consents'),
  });
}

export function useExportStatus() {
  return useQuery({
    queryKey: ['export'],
    queryFn: () => api<DataExport>('/me/export'),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 4000 : false),
  });
}

export function useStartExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DataExport>('/me/export', { method: 'POST', body: {} }),
    onSuccess: (data) => qc.setQueryData(['export'], data),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (body: { confirmPseudonym: string }) => api<{ ok: boolean }>('/me/delete', { body }),
  });
}

/* ------------------------------------------------------------------- admin */

export function useAdminReports(status: string) {
  return useQuery({
    queryKey: ['adminReports', status],
    queryFn: () => api<{ items: AdminReportView[] }>('/admin/reports', { query: { status } }),
  });
}

export interface AdminModerateBody {
  action: string;
  targetUserId?: string;
  targetEventId?: string;
  targetMatchId?: string;
  reportId?: string;
  reason: string;
  durationHours?: number;
}

export function useAdminModerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminModerateBody) => api<{ ok: boolean }>('/admin/moderate', { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adminReports'] });
      void qc.invalidateQueries({ queryKey: ['adminUsers'] });
      void qc.invalidateQueries({ queryKey: ['adminEvents'] });
    },
  });
}

export function useAdminUsers(q: string) {
  return useQuery({
    queryKey: ['adminUsers', q],
    queryFn: () => api<{ items: AdminUserView[] }>('/admin/users', { query: { q } }),
    enabled: q.length > 0,
  });
}

export interface AdminEventRow extends EventSummary {
  matchingPaused?: boolean;
  /** Server field: false = a public listing still awaiting approval. */
  publicApproved?: boolean;
}

export function useAdminEvents(params: { status?: string; pendingApproval?: boolean }) {
  return useQuery({
    queryKey: ['adminEvents', params],
    queryFn: () =>
      api<{ items: AdminEventRow[] }>('/admin/events', {
        query: { status: params.status, pendingApproval: params.pendingApproval },
      }),
  });
}

export function useAdminNotice() {
  return useMutation({
    mutationFn: ({ eventId, body, urgent }: { eventId: string; body: string; urgent: boolean }) =>
      api<{ ok: boolean }>(`/admin/events/${eventId}/notice`, { body: { body, urgent } }),
  });
}

export function useAdminCategories() {
  return useQuery({
    queryKey: ['adminCategories'],
    queryFn: async () => {
      const res = await api<{ items?: Category[]; categories?: Category[] }>('/admin/categories');
      return res.items ?? res.categories ?? [];
    },
  });
}

export function useAdminPatchCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; active?: boolean; restricted?: boolean; maxRequestQty?: number; maxOfferQty?: number }) =>
      api<unknown>('/admin/categories', { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adminCategories'] });
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
    },
  });
}

export function useAdminFlags() {
  return useQuery({
    queryKey: ['adminFlags'],
    queryFn: async () => {
      const res = await api<{ items?: FeatureFlag[]; flags?: FeatureFlag[] }>('/admin/flags');
      return res.items ?? res.flags ?? [];
    },
  });
}

export function useAdminPatchFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; enabled: boolean }) => api<unknown>('/admin/flags', { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['adminFlags'] }),
  });
}

export interface AdminAppeal {
  id: string;
  status?: string;
  createdAt?: string;
  userPseudonym?: string;
  body?: string;
  [key: string]: unknown;
}

export function useAdminAppeals() {
  return useQuery({
    queryKey: ['adminAppeals'],
    queryFn: async () => {
      const res = await api<{ items?: AdminAppeal[] }>('/admin/appeals');
      return res.items ?? [];
    },
  });
}

export function useAdminResolveAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, uphold }: { id: string; reason: string; uphold: boolean }) =>
      api<unknown>(`/admin/appeals/${id}/resolve`, { body: { reason, uphold } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['adminAppeals'] }),
  });
}

export interface AuditEntry {
  id: string;
  action?: string;
  actorPseudonym?: string;
  reason?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export function useAdminAudit() {
  return useQuery({
    queryKey: ['adminAudit'],
    queryFn: async () => {
      const res = await api<{ items?: AuditEntry[]; nextCursor?: string | null }>('/admin/audit');
      return res.items ?? [];
    },
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['adminStats'],
    queryFn: () => api<Record<string, unknown>>('/admin/stats'),
  });
}

export function useEmergencyShutdown() {
  return useMutation({
    mutationFn: (body: { reason: string }) => api<{ ok: boolean }>('/admin/emergency-shutdown', { body }),
  });
}
