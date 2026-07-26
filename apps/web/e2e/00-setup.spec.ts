/**
 * Suite bootstrap: creates the shared unlisted event via the API (as the
 * organizer) and persists {eventId, eventCode} to e2e/.state.json for the
 * remaining spec files. Runs first by filename order (single worker).
 */
import { expect, test } from '@playwright/test';
import { EVENT_CENTER } from './env';
import { apiRaw, loginViaApi, writeState } from './helpers';

const ORGANIZER_PHONE = '+915510000001';

test.describe.configure({ mode: 'serial' });

test('organizer creates the shared unlisted event', async ({ request }) => {
  const organizer = await loginViaApi(request, ORGANIZER_PHONE);
  expect(organizer.token).toBeTruthy();

  const now = Date.now();
  const { event } = await apiRaw<{ event: { id: string; code: string; status: string } }>(request, '/events', {
    token: organizer.token,
    body: {
      title: 'Sahay E2E Community Event',
      description: 'Shared fixture event for the end-to-end suite.',
      type: 'community_event',
      visibility: 'unlisted',
      areaLabel: 'Near Shaniwar Wada, Pune',
      center: EVENT_CENTER,
      radiusM: 3000,
      startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      timezone: 'Asia/Kolkata',
    },
  });

  // The active window already includes "now", so matching is live immediately.
  expect(event.status).toBe('active');
  expect(event.code).toMatch(/\w/);

  writeState({ eventId: event.id, eventCode: event.code, organizerPhone: ORGANIZER_PHONE });
});
