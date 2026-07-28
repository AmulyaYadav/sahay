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

/* --------------------------------------------------------------- catalogue */

export function useCatalogue() {
  return useQuery({
    queryKey: ['catalogue'],
    queryFn: () => api<{ categories: Category[] }>('/catalogue'),
    staleTime: 10 * 60_000,
  });
}

/* --------------------------------------------------- availability/location */

export function pingLocation(eventId: string, coords: { lat: number; lng: number }) {
  return api<{ ok: boolean; expiresAt: string }>(`/events/${eventId}/location`, {
    method: 'PUT',
    body: { coords },
  });
}

export function deleteLocation(eventId: string) {
  return api<{ ok: boolean }>(`/events/${eventId}/location`, { method: 'DELETE' });
}

export function markConversationRead(conversationId: string) {
  return api<{ ok: boolean }>(`/conversations/${conversationId}/read`, { method: 'POST', body: {} });
}

/* ---------------------------------------------------------- notifications */

/** zRegisterPush — token is the JSON-serialized PushSubscription for provider 'webpush'. */
export function registerPushToken(token: string) {
  return api<{ ok: boolean }>('/me/push-tokens', { body: { provider: 'webpush', token } });
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
  /** Category slugs currently declared as admin wants for this event. */
  adminWantSlugs?: string[];
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

export function useAdminSetWants(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categorySlugs: string[]) =>
      api<{ ok: boolean }>(`/admin/events/${eventId}/wants`, { method: 'PATCH', body: { categorySlugs } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['event', eventId] });
      void qc.invalidateQueries({ queryKey: ['adminEvents'] });
    },
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
