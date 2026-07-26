import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  Category,
  EventDashboard,
  EventDetail,
  EventSummary,
  InventoryItem,
  MatchView,
  Message,
  Notification,
  OfferView,
  RequestView,
} from '@sahay/shared';
import { z } from 'zod';
import { zBringSuggestion, zConversationView, zNotificationPrefs, zAvailability, zSessionInfo } from '@sahay/shared';
import { api } from './api';
import { useAuth } from './auth';

export type BringSuggestion = z.infer<typeof zBringSuggestion>;
export type ConversationView = z.infer<typeof zConversationView>;
export type NotificationPrefs = z.infer<typeof zNotificationPrefs>;
export type Availability = z.infer<typeof zAvailability>;
export type SessionInfo = z.infer<typeof zSessionInfo>;

/** Query keys, centralized so WS handlers can invalidate consistently. */
export const qk = {
  catalogue: ['catalogue'] as const,
  events: (q: string) => ['events', q] as const,
  event: (id: string) => ['event', id] as const,
  dashboard: (id: string) => ['dashboard', id] as const,
  bring: (id: string) => ['bring', id] as const,
  inventory: (eventId: string) => ['inventory', eventId] as const,
  availability: (eventId: string) => ['availability', eventId] as const,
  myRequests: (eventId?: string) => ['requests', eventId ?? 'all'] as const,
  request: (id: string) => ['request', id] as const,
  pendingOffers: ['offers', 'pending'] as const,
  activeMatches: ['matches', 'active'] as const,
  match: (id: string) => ['match', id] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  notifications: ['notifications'] as const,
  notificationPrefs: ['notificationPrefs'] as const,
  sessions: ['sessions'] as const,
  blocks: ['blocks'] as const,
  consents: ['consents'] as const,
};

export function useCatalogue(): UseQueryResult<{ categories: Category[] }> {
  return useQuery({
    queryKey: qk.catalogue,
    queryFn: () => api<{ categories: Category[] }>('/catalogue'),
    staleTime: 1000 * 60 * 30,
  });
}

export function useEventSearch(q: string) {
  return useQuery({
    queryKey: qk.events(q),
    queryFn: () =>
      api<{ items: EventSummary[]; nextCursor?: string }>('/events', { query: { q, limit: 30 } }),
    staleTime: 1000 * 60,
  });
}

export function useEvent(idOrCode: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.event(idOrCode ?? 'none'),
    queryFn: () => api<EventDetail>(`/events/${idOrCode}`, { token }),
    enabled: !!idOrCode,
    staleTime: 1000 * 60,
  });
}

export function useDashboard(eventId: string | null | undefined) {
  return useQuery({
    queryKey: qk.dashboard(eventId ?? 'none'),
    queryFn: () => api<EventDashboard>(`/events/${eventId}/dashboard`),
    enabled: !!eventId,
    refetchInterval: 60_000,
  });
}

export function useBring(eventId: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.bring(eventId ?? 'none'),
    queryFn: () => api<{ suggestions: BringSuggestion[] }>(`/events/${eventId}/bring`, { token }),
    enabled: !!eventId && !!token,
  });
}

export function useInventory(eventId: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.inventory(eventId ?? 'none'),
    queryFn: () => api<{ items: InventoryItem[] }>(`/events/${eventId}/inventory`, { token }),
    enabled: !!eventId && !!token,
  });
}

export function useAvailability(eventId: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.availability(eventId ?? 'none'),
    queryFn: () => api<Availability>(`/events/${eventId}/availability`, { token }),
    enabled: !!eventId && !!token,
  });
}

export function useMyRequests(eventId?: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.myRequests(eventId),
    queryFn: () =>
      api<{ items: RequestView[] }>('/requests/mine', { token, query: { eventId } }),
    enabled: !!token,
    refetchInterval: 20_000,
  });
}

export function useRequest(id: string | null | undefined, opts?: { poll?: boolean }) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.request(id ?? 'none'),
    queryFn: () => api<RequestView>(`/requests/${id}`, { token }),
    enabled: !!id && !!token,
    refetchInterval: opts?.poll ? 5_000 : undefined,
  });
}

export function usePendingOffers(opts?: { poll?: boolean }) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.pendingOffers,
    queryFn: () => api<{ items: OfferView[] }>('/offers/pending', { token }),
    enabled: !!token,
    refetchInterval: opts?.poll ? 20_000 : undefined,
  });
}

export function useActiveMatches() {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.activeMatches,
    queryFn: () => api<{ items: MatchView[] }>('/matches/active', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
}

export function useMatch(id: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.match(id ?? 'none'),
    queryFn: () => api<MatchView>(`/matches/${id}`, { token }),
    enabled: !!id && !!token,
    refetchInterval: 10_000,
  });
}

export function useConversation(id: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.conversation(id ?? 'none'),
    queryFn: () => api<ConversationView>(`/conversations/${id}`, { token }),
    enabled: !!id && !!token,
  });
}

/** Poll fallback every 10 s; WS message.new invalidates for instant delivery. */
export function useMessages(conversationId: string | null | undefined) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.messages(conversationId ?? 'none'),
    queryFn: () =>
      api<{ items: Message[]; nextCursor?: string }>(
        `/conversations/${conversationId}/messages`,
        { token, query: { limit: 100 } },
      ),
    enabled: !!conversationId && !!token,
    refetchInterval: 10_000,
  });
}

export function useNotifications() {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () =>
      api<{ items: Notification[]; nextCursor?: string }>('/me/notifications', {
        token,
        query: { limit: 50 },
      }),
    enabled: !!token,
  });
}

export function useNotificationPrefs() {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.notificationPrefs,
    queryFn: () => api<NotificationPrefs>('/me/notification-prefs', { token }),
    enabled: !!token,
  });
}

export function useSessions() {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => api<SessionInfo[]>('/auth/sessions', { token }),
    enabled: !!token,
  });
}

export function useBlocks() {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.blocks,
    queryFn: () => api<{ blocks: { createdAt: string; alias: string }[] }>('/me/blocks', { token }),
    enabled: !!token,
  });
}

export function useConsents() {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.consents,
    queryFn: () =>
      api<{ items: { kind: string; granted: boolean; createdAt: string }[] }>('/me/consents', {
        token,
      }),
    enabled: !!token,
  });
}

/** Invalidate everything relevant after reconnecting (WS or network). */
export function useInvalidateLive() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['request'] });
    void qc.invalidateQueries({ queryKey: qk.pendingOffers });
    void qc.invalidateQueries({ queryKey: qk.activeMatches });
    void qc.invalidateQueries({ queryKey: ['match'] });
    void qc.invalidateQueries({ queryKey: ['messages'] });
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: qk.notifications });
  };
}
