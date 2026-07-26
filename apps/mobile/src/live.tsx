import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { WsFrame } from '@sahay/shared';
import { useAuth } from './auth';
import { useActiveEvent } from './activeEvent';
import { qk, useAvailability, useInvalidateLive, usePendingOffers } from './hooks';
import { useRealtime } from './realtime';
import { useNotificationDeepLinks } from './push';

/**
 * Always-mounted live layer:
 *  - WebSocket connection with query invalidation per frame
 *  - session.revoked → sign out
 *  - offer listener: WS `offer.new` OR 20 s polling while Helping Now is ON
 *    → full-screen offer modal
 *  - push notification tap → deep link routing
 */
export function GlobalLive() {
  const { token, signOut } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const invalidateLive = useInvalidateLive();
  const { activeEventId } = useActiveEvent();
  const availability = useAvailability(activeEventId);
  const helpingNow = availability.data?.on === true;

  useNotificationDeepLinks(!!token);

  useRealtime(token, {
    onFrame: (frame: WsFrame) => {
      switch (frame.event) {
        case 'offer.new':
        case 'offer.expired':
          void qc.invalidateQueries({ queryKey: qk.pendingOffers });
          break;
        case 'request.update':
          void qc.invalidateQueries({ queryKey: ['requests'] });
          void qc.invalidateQueries({ queryKey: ['request'] });
          break;
        case 'match.update':
          void qc.invalidateQueries({ queryKey: qk.activeMatches });
          void qc.invalidateQueries({ queryKey: ['match'] });
          break;
        case 'message.new':
        case 'conversation.update':
          void qc.invalidateQueries({ queryKey: ['messages'] });
          void qc.invalidateQueries({ queryKey: ['conversation'] });
          break;
        case 'event.update':
          void qc.invalidateQueries({ queryKey: ['event'] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
          break;
        case 'inventory.update':
          void qc.invalidateQueries({ queryKey: ['inventory'] });
          break;
        case 'notification.new':
          void qc.invalidateQueries({ queryKey: qk.notifications });
          break;
        default:
          break;
      }
    },
    onReconnect: invalidateLive,
    onSessionRevoked: () => {
      void signOut({ revokeServerSession: false });
      router.replace('/auth');
    },
  });

  // Poll pending offers every 20 s while Helping Now is on (WS fallback).
  const offers = usePendingOffers({ poll: helpingNow });

  // Surface exactly-once: push each unseen open offer as a full-screen modal.
  const seenOffers = useRef<Set<string>>(new Set());
  useEffect(() => {
    const items = offers.data?.items ?? [];
    for (const offer of items) {
      if (offer.status !== 'offered') continue;
      if (new Date(offer.respondBy).getTime() <= Date.now()) continue;
      if (seenOffers.current.has(offer.id)) continue;
      seenOffers.current.add(offer.id);
      router.push(`/offer/${offer.id}`);
      break; // one at a time
    }
  }, [offers.data, router]);

  return null;
}
