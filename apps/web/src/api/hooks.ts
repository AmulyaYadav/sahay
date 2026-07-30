/**
 * Typed react-query hooks for every endpoint the web app uses.
 * Response types come from @sahay/shared zod schemas — the server is built to the same contract.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AdminCreated,
  AdminWant,
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
  zAvailability,
  zBringSuggestion,
  zConversationView,
  zDataExport,
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

/* -------------------------------------------------------------------- auth */

export function useMe(enabled = true): UseQueryResult<Me> {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
    enabled: enabled && !!getToken(),
    staleTime: 60_000,
  });
}

/**
 * Staff sign-in. The web app is the admin console only, and admin credentials
 * are issued by the operators, so there is no OTP flow here — volunteers sign
 * in with email OTP on mobile instead (ADR-0013).
 */
export function usePasswordLogin() {
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api<AuthSession>('/auth/login', {
        body: { ...body, device: { platform: 'web', name: navigator.userAgent.slice(0, 60) } },
      }),
  });
}

/**
 * Replaces the caller's own password. Revokes every other session server-side,
 * so the generated password we mailed out stops working once this succeeds.
 */
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api<{ ok: boolean }>('/auth/password', { body }),
    onSuccess: () => {
      // Write the cleared flag straight into the cache rather than waiting for
      // a refetch: callers navigate immediately on success, and RequireModerator
      // reads this value synchronously — a stale `true` bounces them right back
      // to the change-password screen they just completed.
      qc.setQueryData<Me>(['me'], (prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
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
      void qc.invalidateQueries({ queryKey: ['adminEvents'] });
    },
  });
}

export interface AdminEventRow extends EventSummary {
  matchingPaused?: boolean;
  /** Server field: false = a public listing still awaiting approval. */
  publicApproved?: boolean;
  /** Wants currently declared for this event, with optional target quantities. */
  adminWants?: AdminWant[];
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

export interface CreateAdminBody {
  username: string;
  email: string;
  role: 'moderator' | 'admin';
}

export function useCreateAdmin() {
  return useMutation({
    mutationFn: (body: CreateAdminBody) => api<AdminCreated>('/admin/admins', { body }),
  });
}

export function useResetAdminPassword() {
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ password: string }>(`/admin/admins/${userId}/reset-password`, { method: 'POST', body: {} }),
  });
}

export function useAdminSetWants(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wants: AdminWant[]) =>
      api<{ ok: boolean }>(`/admin/events/${eventId}/wants`, { method: 'PATCH', body: { wants } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['event', eventId] });
      void qc.invalidateQueries({ queryKey: ['adminEvents'] });
    },
  });
}

