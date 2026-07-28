# Public Web Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Sahay web app into (1) a public, unauthenticated landing page listing currently-active events with their top wants and a volunteer-recruitment CTA pointing at the mobile app, and (2) a trimmed admin console scoped to exactly event CRUD and event-wants curation — removing every other authenticated web flow (request, match, settings, profile) since mobile is now the app for volunteers/requesters.

**Architecture:** Server gains one new concept, "public wants" per event — an unweighted (no k-anonymity floor) merge of admin-curated categories and real aggregated user demand, deliberately distinct from the existing k-anonymized `computeDashboard`. Event creation moves from "any authenticated user" to "moderator/admin only," reusing the existing `createEvent` service function with a tightened role guard. Event "deletion" reuses the existing, already-admin-gated `event_disable` moderation action (soft-disable with cascading match/request cleanup) rather than a new hard-delete. The web app's route tree shrinks from ~13 routes to 6; nine now-orphaned page/component files and dozens of now-dead API hooks are deleted; the admin panel's `EventsSection` gains create/wants UI.

**Tech Stack:** Fastify + Drizzle + PostgreSQL (server), React Router + TanStack Query (web), Zod schemas in `@sahay/shared`, Vitest (unit/integration), Playwright (e2e).

## Global Constraints

- Reuse the existing "Warm Relief" design system (`docs/design-system.md`, `apps/web/src/ui/tokens.css`, `components.tsx`, `patterns.tsx`) for every new UI element — no new visual language.
- Every user-facing string change must be mirrored in both `packages/shared/src/i18n/en.ts` and `hi.ts`.
- The public-wants computation deliberately has **no k-anonymity floor** (shows demand starting from 1 requester) — this is a confirmed, deliberate product decision specific to this view. `computeDashboard`'s k-anonymity behavior must NOT change for any other consumer.
- Admin-declared wants are ordered by the existing `categories.sortOrder` — no new per-event ordering column.
- Event "delete" in the admin UI must route through the existing `event_disable` moderation action (`POST /admin/moderate` with `action: 'event_disable'`) — do not add a hard DB delete for events.
- `POST /events` (event creation) becomes moderator/admin-only — reuse the existing `createEvent` service function unchanged; only the route's `preHandler` role guard changes.
- Do not modify the mobile app in this plan.

---

## File Structure

**Server:**
- `server/migrations/0003_public_wants.sql` — new. Adds `event_categories.admin_want`.
- `server/src/db/schema.ts` — modify: add `adminWant` to `eventCategories`.
- `server/src/modules/events/wants.ts` — new. `computePublicWants(eventIds)`, `setAdminWants(eventId, categorySlugs)`.
- `server/src/modules/events/service.ts` — modify: `toSummary`/`buildEventDetail`/`searchEvents` include `wants`.
- `server/src/modules/events/routes.ts` — modify: `POST /events` role-gated to moderator/admin.
- `server/src/modules/admin/routes.ts`, `admin/service.ts` — modify: new `PATCH /admin/events/:id/wants` route.
- `server/test/unit/wants.test.ts`, `server/test/integration/wants.test.ts`, `server/test/integration/events.test.ts` (extend) — new/modified tests.

**Shared:**
- `packages/shared/src/schemas.ts` — modify: `zPublicWant`, `wants` field on `zEventSummary`, `zAdminEventWants`.
- `packages/shared/src/i18n/en.ts`, `hi.ts` — modify: new `landing.*`, `eventPage.*`, `admin.*` keys for wants/volunteer CTA/admin event management.

**Web — deleted:**
- `apps/web/src/pages/Home.tsx`, `MatchRoom.tsx`, `Settings.tsx`, `RequestFlow.tsx`, `Events.tsx`, `Profile.tsx`
- `apps/web/src/components/BringPanel.tsx`, `InventoryPanel.tsx`, `OfferSheet.tsx`, `RequestStatusCard.tsx`, `DashboardPanel.tsx`, `ReportDialog.tsx`

**Web — modified:**
- `apps/web/src/App.tsx` — trimmed route list.
- `apps/web/src/components/AppShell.tsx` — simplified nav, no `OfferSheet`, no `RequireAuth`, add sign-out affordance.
- `apps/web/src/pages/Landing.tsx` — rewritten: public event list (merges today's marketing intro + today's `Events.tsx` discovery list).
- `apps/web/src/pages/EventPage.tsx` — rewritten: fully public, read-only detail (description, safety/medical, notices, full wants list, volunteer CTA); no join/leave/report/bring/supplies/request.
- `apps/web/src/pages/CreateEvent.tsx` — relocated under admin, reused mostly as-is.
- `apps/web/src/pages/admin/AdminPage.tsx` — `EventsSection` gains create-event and wants-management UI; delete button wired to `event_disable`.
- `apps/web/src/api/hooks.ts` — prune ~40 dead hooks; add `useAdminSetWants`.

**Web — new:**
- `apps/web/src/components/PublicWants.tsx` — want chips (admin-badge vs user-requested).
- `apps/web/src/components/VolunteerCta.tsx` — "become a volunteer" section with app-store badge placeholders.

**E2E:**
- Deleted: `01-core-loop.spec.ts`, `02-decline-timeout.spec.ts`, `03-partial-and-continue.spec.ts`, `04-cancel-renew-expire.spec.ts`, `05-safety.spec.ts`, `07-settings-privacy.spec.ts`, `08-offline.spec.ts`.
- Modified: `00-setup.spec.ts` (organizer becomes an admin), `06-admin.spec.ts` (drop the RequestFlow-coupled sub-test).
- New: `09-public-landing.spec.ts`.

**Docs:**
- `docs/adr/0012-admin-only-event-creation-and-public-wants.md` — new.

---

### Task 1: Migration + schema for admin-declared wants

**Files:**
- Create: `server/migrations/0003_public_wants.sql`
- Modify: `server/src/db/schema.ts`
- Test: `server/test/integration/schema.test.ts` (extend)

**Interfaces:**
- Produces: `schema.eventCategories.adminWant` (boolean, not null, default false).

- [ ] **Step 1: Write the migration**

Create `server/migrations/0003_public_wants.sql`:

```sql
-- Admin-curated "current wants" for the public landing page. Ordering among
-- admin-declared wants uses the existing categories.sort_order — no new
-- per-event ordering column needed.

ALTER TABLE event_categories
  ADD COLUMN admin_want boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Update the Drizzle schema**

In `server/src/db/schema.ts`, in the `eventCategories` table definition, add after `maxOfferQty: numeric('max_offer_qty'),`:

```ts
    adminWant: boolean('admin_want').notNull().default(false),
```

- [ ] **Step 3: Extend the schema-applies test**

In `server/test/integration/schema.test.ts`, add a new `it` inside the existing `describe`:

```ts
it('adds admin_want to event_categories', async () => {
  const db = getDb();
  const cols = await db.execute(sql`
    SELECT column_name, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'event_categories' AND column_name = 'admin_want'
  `);
  expect(cols.rows).toHaveLength(1);
  expect(cols.rows[0]!.is_nullable).toBe('NO');
});
```

(Check the file's existing imports already include `sql`, `getDb` — they do, per the earlier `0002` migration test in this same file.)

- [ ] **Step 4: Run the test**

Run: `npm run test:integration -w server -- schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/0003_public_wants.sql server/src/db/schema.ts server/test/integration/schema.test.ts
git commit -m "feat(server): add admin_want column to event_categories"
```

---

### Task 2: Shared schemas and i18n for public wants

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/i18n/en.ts`, `hi.ts`
- Test: `packages/shared/test/schemas.test.ts`, `packages/shared/test/i18n.test.ts` (extend)

**Interfaces:**
- Produces: `zPublicWant` (exported type `PublicWant`), `zEventSummary.wants: PublicWant[]`, `zAdminEventWants` (exported type `AdminEventWantsInput`).

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/test/schemas.test.ts`:

```ts
import { zEventSummary, zPublicWant, zAdminEventWants } from '../src/schemas.js';

describe('public wants schemas', () => {
  it('zPublicWant requires categorySlug, source, and qty', () => {
    const result = zPublicWant.safeParse({
      categorySlug: 'water-bottle',
      source: 'admin',
      requestedQty: null,
      requesterCount: null,
    });
    expect(result.success).toBe(true);
    expect(zPublicWant.safeParse({ categorySlug: 'x', source: 'bogus' }).success).toBe(false);
  });

  it('zEventSummary includes a wants array', () => {
    expect(zEventSummary.shape).toHaveProperty('wants');
  });

  it('zAdminEventWants accepts a list of category slugs', () => {
    expect(zAdminEventWants.safeParse({ categorySlugs: ['water-bottle', 'blanket'] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/shared -- schemas.test.ts`
Expected: FAIL (`zPublicWant`/`zAdminEventWants` don't exist; `zEventSummary` has no `wants` field).

- [ ] **Step 3: Implement — add to `packages/shared/src/schemas.ts`**

Add near `zEventSummary` (before it, since `zEventSummary` will reference it):

```ts
export const zPublicWant = z.object({
  categorySlug: z.string(),
  source: z.enum(['admin', 'user']),
  requestedQty: z.number().nullable(), // null when source is 'admin' and no real demand exists yet
  requesterCount: z.number().int().nullable(), // null when source is 'admin'
});
export type PublicWant = z.infer<typeof zPublicWant>;
```

Replace the existing `zEventSummary` definition:

```ts
export const zEventSummary = z.object({
  id: zUuid,
  code: z.string(), // short public identifier, e.g. "MELA-7K2F"
  title: z.string(),
  type: z.enum(EVENT_TYPES),
  status: z.enum(EVENT_STATUSES),
  visibility: z.enum(EVENT_VISIBILITIES),
  areaLabel: z.string(), // "Near City Park, Pune" — never precise
  startsAt: zIsoDate,
  endsAt: zIsoDate,
  timezone: z.string(),
  joined: z.boolean().optional(),
});
```

with:

```ts
export const zEventSummary = z.object({
  id: zUuid,
  code: z.string(), // short public identifier, e.g. "MELA-7K2F"
  title: z.string(),
  type: z.enum(EVENT_TYPES),
  status: z.enum(EVENT_STATUSES),
  visibility: z.enum(EVENT_VISIBILITIES),
  areaLabel: z.string(), // "Near City Park, Pune" — never precise
  startsAt: zIsoDate,
  endsAt: zIsoDate,
  timezone: z.string(),
  joined: z.boolean().optional(),
  wants: z.array(zPublicWant), // top-3 merged wants on list views, full list on detail
});
```

(`zEventDetail = zEventSummary.extend({...})` already inherits `wants` automatically — no change needed there.)

Add near `zCreateEvent`:

```ts
export const zAdminEventWants = z.object({
  categorySlugs: z.array(z.string()).max(50),
});
export type AdminEventWantsInput = z.infer<typeof zAdminEventWants>;
```

- [ ] **Step 4: Add i18n keys**

In `packages/shared/src/i18n/en.ts`, add to the `landing` section (after `installBody`):

```ts
    volunteerTitle: 'Become a Sahay volunteer',
    volunteerBody: 'Download the Sahay app to offer help, respond to requests, and coordinate with your community during an event.',
    volunteerCta: 'Get the Sahay app',
    appStoreBadge: 'Download on the App Store',
    playStoreBadge: 'Get it on Google Play',
    noActiveEvents: 'No active events right now. Check back soon.',
```

Add to the `eventPage` section (find it via `grep -n "eventPage:" packages/shared/src/i18n/en.ts` first to see its current keys and insert alongside them, matching existing indentation):

```ts
    wantsTitle: 'What this event needs',
    wantsEmpty: 'No specific wants have been listed yet.',
    wantAdminBadge: 'Confirmed need',
```

Add a new `admin` sub-keys (find the `admin:` section via grep, add alongside existing `admin.*` keys):

```ts
    createEvent: 'Create event',
    deleteEvent: 'Delete event',
    deleteEventConfirm: 'This event will be hidden from the public and any active exchanges will be cancelled.',
    manageWants: 'Manage wants',
    wantsHint: 'Pick the categories this event currently needs. They show first on the public page.',
```

Mirror ALL of the above in `packages/shared/src/i18n/hi.ts` with natural Hindi translations, matching the style/tone of the existing `landing.*`/`eventPage.*`/`admin.*` Hindi strings already in that file (e.g. how `landing.heroTitle`/`admin.approve` etc. are phrased).

- [ ] **Step 5: Run tests, rebuild**

Run: `npm run test -w packages/shared` then `npm run build -w packages/shared`
Expected: all PASS, build exits 0. The i18n key-parity test (`i18n.test.ts`) will fail if en/hi key sets diverge — fix any mismatch it reports.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/i18n/en.ts packages/shared/src/i18n/hi.ts packages/shared/test/schemas.test.ts
git commit -m "feat(shared): add public-wants schemas and i18n keys"
```

---

### Task 3: `computePublicWants` and `setAdminWants` service functions

**Files:**
- Create: `server/src/modules/events/wants.ts`
- Test: `server/test/unit/wants.test.ts`

**Interfaces:**
- Consumes: `schema.eventCategories.adminWant` (Task 1), `zPublicWant`/`PublicWant` (Task 2).
- Produces: `computePublicWants(eventIds: string[]): Promise<Map<string, PublicWant[]>>` (full, merged, sorted list per event — admin wants first ordered by `categories.sortOrder`, then user-requested sorted by qty descending, deduplicated by category), `setAdminWants(eventId: string, categorySlugs: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `server/test/unit/wants.test.ts`:

```ts
import '../env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '../../src/db/index.js';
import { setupTestDb, truncateAll, makeEvent, categoryBySlug } from '../helpers.js';
import { computePublicWants, setAdminWants } from '../../src/modules/events/wants.js';

beforeAll(async () => {
  await setupTestDb();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe('computePublicWants', () => {
  it('returns admin-declared wants first, then real demand, with no k-anonymity floor', async () => {
    const event = await makeEvent();
    const water = await categoryBySlug('water-bottle');
    const blanket = await categoryBySlug('blanket');

    await setAdminWants(event.id, [blanket.slug]);

    // A single open request for water — must show up despite only 1 requester.
    const db = getDb();
    const [requester] = await db.insert(schema.users).values({ pseudonym: 'X', avatarSeed: 'X' }).returning();
    await db.insert(schema.requests).values({
      eventId: event.id,
      requesterId: requester!.id,
      categoryId: water.id,
      qty: '3',
      qtyFulfilled: '0',
      unit: water.unit,
      status: 'searching',
      urgency: 'standard',
    });

    const result = await computePublicWants([event.id]);
    const wants = result.get(event.id)!;
    expect(wants[0]).toMatchObject({ categorySlug: blanket.slug, source: 'admin' });
    expect(wants.some((w) => w.categorySlug === water.slug && w.source === 'user' && w.requesterCount === 1)).toBe(
      true,
    );
  });

  it('caps nothing — returns the full merged list (callers cap for list views)', async () => {
    const event = await makeEvent();
    const cats = ['water-bottle', 'blanket', 'sanitary-pad', 'diaper', 'first-aid-kit'];
    for (const slug of cats) {
      const c = await categoryBySlug(slug);
      await setAdminWants(event.id, [...(await getAdminWantSlugs(event.id)), c.slug]);
    }
    const result = await computePublicWants([event.id]);
    expect(result.get(event.id)!.length).toBeGreaterThanOrEqual(5);
  });
});

async function getAdminWantSlugs(eventId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: schema.categories.slug })
    .from(schema.eventCategories)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.eventCategories.categoryId))
    .where(eq(schema.eventCategories.eventId, eventId));
  return rows.filter((r, i, arr) => arr.findIndex((x) => x.slug === r.slug) === i).map((r) => r.slug);
}
```

Before writing this, run `grep -n "export async function makeEvent\|export async function categoryBySlug" server/test/helpers.ts` to confirm the exact current signatures of these two test helpers (they exist already per prior exploration — `makeEvent`/`MakeEventOptions` and a `categoryBySlug` used elsewhere in integration tests) and adjust the test's calls to match their real parameter shapes exactly (e.g. `makeEvent()` may require a creator id argument — check before assuming a no-arg call works).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server -- wants.test.ts`
Expected: FAIL (`server/src/modules/events/wants.js` doesn't exist).

- [ ] **Step 3: Implement `server/src/modules/events/wants.ts`**

```ts
/**
 * "Public wants" for an event: a merge of admin-curated categories and real
 * aggregated demand, shown on the anonymous public pages. Deliberately has NO
 * k-anonymity floor (unlike computeDashboard) — see ADR-0012. Admin wants are
 * always first, ordered by the catalogue's own sortOrder; user-requested wants
 * follow, sorted by total requested quantity.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PublicWant } from '@sahay/shared';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';

export async function computePublicWants(eventIds: string[]): Promise<Map<string, PublicWant[]>> {
  const result = new Map<string, PublicWant[]>();
  if (eventIds.length === 0) return result;
  const db = getDb();

  const adminRows = await db
    .select({
      eventId: schema.eventCategories.eventId,
      slug: schema.categories.slug,
      sortOrder: schema.categories.sortOrder,
    })
    .from(schema.eventCategories)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.eventCategories.categoryId))
    .where(and(inArray(schema.eventCategories.eventId, eventIds), eq(schema.eventCategories.adminWant, true)))
    .orderBy(asc(schema.categories.sortOrder));

  const demandRows = await db.execute(sql`
    SELECT r.event_id AS event_id, c.slug AS slug,
           COALESCE(SUM(r.qty - r.qty_fulfilled), 0) AS req_qty,
           COUNT(DISTINCT r.requester_id) AS requesters
    FROM requests r
    JOIN categories c ON c.id = r.category_id
    WHERE r.event_id = ANY(${eventIds}) AND r.status IN ('searching', 'offering')
    GROUP BY r.event_id, c.slug
    ORDER BY req_qty DESC
  `);

  for (const eventId of eventIds) {
    const adminSlugs = new Set(adminRows.filter((r) => r.eventId === eventId).map((r) => r.slug));
    const admin: PublicWant[] = adminRows
      .filter((r) => r.eventId === eventId)
      .map((r) => ({ categorySlug: r.slug, source: 'admin' as const, requestedQty: null, requesterCount: null }));
    const user: PublicWant[] = demandRows.rows
      .filter((r) => String(r.event_id) === eventId && !adminSlugs.has(String(r.slug)))
      .map((r) => ({
        categorySlug: String(r.slug),
        source: 'user' as const,
        requestedQty: Number(r.req_qty),
        requesterCount: Number(r.requesters),
      }));
    result.set(eventId, [...admin, ...user]);
  }
  return result;
}

export async function setAdminWants(eventId: string, categorySlugs: string[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const cats = categorySlugs.length
      ? await tx
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(inArray(schema.categories.slug, categorySlugs))
      : [];
    if (categorySlugs.length > 0 && cats.length !== new Set(categorySlugs).size) {
      throw errors.validation({ field: 'categorySlugs' });
    }
    const wantedIds = new Set(cats.map((c) => c.id));

    // Clear admin_want from anything no longer wanted.
    await tx
      .update(schema.eventCategories)
      .set({ adminWant: false })
      .where(eq(schema.eventCategories.eventId, eventId));

    for (const categoryId of wantedIds) {
      await tx
        .insert(schema.eventCategories)
        .values({ eventId, categoryId, adminWant: true })
        .onConflictDoUpdate({
          target: [schema.eventCategories.eventId, schema.eventCategories.categoryId],
          set: { adminWant: true },
        });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server -- wants.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/events/wants.ts server/test/unit/wants.test.ts
git commit -m "feat(server): add computePublicWants and setAdminWants"
```

---

### Task 4: Wire wants into event responses; role-gate event creation

**Files:**
- Modify: `server/src/modules/events/service.ts`
- Modify: `server/src/modules/events/routes.ts`
- Test: `server/test/integration/events.test.ts` (extend)

**Interfaces:**
- Consumes: `computePublicWants` (Task 3).
- Produces: `EventSummary.wants` (top-3 in list contexts, full in detail), `EventDetail.wants` (full list). `POST /events` now requires `moderator` role.

- [ ] **Step 1: Write the failing test**

Add to `server/test/integration/events.test.ts` (check the file's existing imports/helpers first via `grep -n "^import" server/test/integration/events.test.ts` and match style):

```ts
it('POST /events is rejected for a non-moderator', async () => {
  const user = await makeAuthedUser();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/events',
    headers: user.headers,
    payload: {
      title: 'Test Drive',
      description: '',
      type: 'community_event',
      visibility: 'unlisted',
      areaLabel: 'Somewhere',
      center: { lat: 18.5, lng: 73.8 },
      radiusM: 2000,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  expect(res.statusCode).toBe(403);
});

it('event search and detail responses include a wants array', async () => {
  const admin = await makeAuthedUser({ role: 'admin' });
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/events',
    headers: admin.headers,
    payload: {
      title: 'Wants Test Event',
      description: '',
      type: 'community_event',
      visibility: 'public',
      areaLabel: 'Somewhere',
      center: { lat: 18.5, lng: 73.8 },
      radiusM: 2000,
      startsAt: new Date(Date.now() - 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  expect(created.statusCode).toBe(200);
  const detail = await app.inject({ url: `/api/v1/events/${created.json().event.code}` });
  expect(detail.json().wants).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -w server -- events.test.ts`
Expected: FAIL (POST /events currently succeeds for any authenticated active user; `wants` field absent from responses).

- [ ] **Step 3: Implement — `server/src/modules/events/service.ts`**

Replace `toSummary` (add a `wants` param, default empty array so existing callers that don't pass it still type-check — but every call site below is updated to pass real wants):

```ts
function toSummary(event: EventRow, wants: PublicWant[], joined?: boolean): EventSummary {
  return {
    id: event.id,
    code: event.code,
    title: event.title,
    type: event.type as EventSummary['type'],
    status: event.status as EventSummary['status'],
    visibility: event.visibility as EventSummary['visibility'],
    areaLabel: event.areaLabel,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    wants,
    ...(joined === undefined ? {} : { joined }),
  };
}
```

Add the import at the top of the file (alongside the existing `@sahay/shared` import list):

```ts
import { computePublicWants } from './wants.js';
```

and add `type PublicWant` to the existing `@sahay/shared` type-only import list.

Update `buildEventDetail` — replace:

```ts
export async function buildEventDetail(event: EventRow, userId: string | null): Promise<EventDetail> {
  const db = getDb();
  const membership = userId ? await getMembership(event.id, userId) : null;
```

with:

```ts
export async function buildEventDetail(event: EventRow, userId: string | null): Promise<EventDetail> {
  const db = getDb();
  const membership = userId ? await getMembership(event.id, userId) : null;
  const wants = (await computePublicWants([event.id])).get(event.id) ?? [];
```

and replace the `return { ...toSummary(event, userId ? membership != null : undefined), ...}` line's `toSummary` call:

```ts
    ...toSummary(event, wants, userId ? membership != null : undefined),
```

Update `searchEvents` — after the existing `const items = rows.map((r) => toSummary(r, userId ? joinedIds.has(r.id) : undefined));` line, replace it with a batched wants lookup capped at 3 per event:

```ts
  const wantsByEvent = await computePublicWants(rows.map((r) => r.id));
  const items = rows.map((r) =>
    toSummary(r, (wantsByEvent.get(r.id) ?? []).slice(0, 3), userId ? joinedIds.has(r.id) : undefined),
  );
```

- [ ] **Step 4: Implement — `server/src/modules/events/routes.ts`**

Find the `POST /events` route registration (check exact current line via `grep -n "app.post.*'/events'" server/src/modules/events/routes.ts` — per the earlier research it's `{ preHandler: [app.authenticate] }`) and change its `preHandler` to:

```ts
{ preHandler: [app.authenticate, app.requireRole('moderator')] }
```

(matching the exact pattern already used in `admin/routes.ts` for the `mod` tier — `app.requireRole('moderator')` allows both `moderator` and `admin` roles, per the existing role hierarchy convention used throughout `admin/routes.ts`; confirm this by reading `server/src/plugins/auth.ts`'s `requireRole` implementation if the hierarchy assumption needs verifying).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:integration -w server -- events.test.ts`
Expected: PASS. Then run the full server suite (`npm run test -w server && npm run test:integration -w server`) to catch any other test that relied on a regular user creating events (there may be several across `match-flow.test.ts`, `offer-accept.test.ts`, etc. — these use `makeEvent()` test helper directly against the DB, not the HTTP route, so they should be unaffected, but verify).

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/events/service.ts server/src/modules/events/routes.ts server/test/integration/events.test.ts
git commit -m "feat(server): include public wants in event responses; restrict event creation to moderators"
```

---

### Task 5: Admin wants-management endpoint

**Files:**
- Modify: `server/src/modules/admin/routes.ts`
- Test: `server/test/integration/admin.test.ts` (extend)

**Interfaces:**
- Consumes: `setAdminWants` (Task 3), `zAdminEventWants` (Task 2).
- Produces: `PATCH /admin/events/:id/wants` (admin role).

- [ ] **Step 1: Write the failing test**

Add to `server/test/integration/admin.test.ts` (inside an appropriate `describe`, following the file's existing patterns for admin-tier tests — check via `grep -n "makeAuthedUser({ role: 'admin'" server/test/integration/admin.test.ts` for the exact style used elsewhere in this file):

```ts
it('PATCH /admin/events/:id/wants sets admin-declared wants', async () => {
  const admin = await makeAuthedUser({ role: 'admin' });
  const event = await makeEvent(admin.user.id);
  const water = await categoryBySlug('water-bottle');

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/events/${event.id}/wants`,
    headers: admin.headers,
    payload: { categorySlugs: [water.slug] },
  });
  expect(res.statusCode).toBe(200);

  const detail = await app.inject({ url: `/api/v1/events/${event.code}` });
  expect(detail.json().wants).toEqual([
    expect.objectContaining({ categorySlug: water.slug, source: 'admin' }),
  ]);
});

it('PATCH /admin/events/:id/wants is rejected for a moderator (admin-tier only)', async () => {
  const moderator = await makeAuthedUser({ role: 'moderator' });
  const admin = await makeAuthedUser({ role: 'admin' });
  const event = await makeEvent(admin.user.id);
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/events/${event.id}/wants`,
    headers: moderator.headers,
    payload: { categorySlugs: [] },
  });
  expect(res.statusCode).toBe(403);
});
```

Before writing this, run `grep -n "export async function makeEvent" server/test/helpers.ts` to get `makeEvent`'s exact real signature (this plan assumes `makeEvent(creatorId)` based on prior exploration — verify and adjust the test calls to match exactly).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -w server -- admin.test.ts`
Expected: FAIL (404, route doesn't exist).

- [ ] **Step 3: Implement — `server/src/modules/admin/routes.ts`**

Add the import:

```ts
import { zAdminEventWants } from '@sahay/shared';
```

(add to the existing `@sahay/shared` import line rather than a new line).

Add the import for `setAdminWants`:

```ts
import { setAdminWants } from '../events/wants.js';
```

Add the route, right after the existing `app.patch<{ Params: { id: string } }>('/admin/events/:id', admin, ...)` block:

```ts
  app.patch<{ Params: { id: string } }>('/admin/events/:id/wants', admin, async (req) => {
    const body = zAdminEventWants.parse(req.body);
    await setAdminWants(zUuid.parse(req.params.id), body.categorySlugs);
    return { ok: true };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -w server -- admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/admin/routes.ts server/test/integration/admin.test.ts
git commit -m "feat(server): add admin endpoint for setting an event's declared wants"
```

---

### Task 6: ADR-0012

**Files:**
- Create: `docs/adr/0012-admin-only-event-creation-and-public-wants.md`

- [ ] **Step 1: Write the ADR**

```markdown
# ADR-0012: Admin-only event creation; public wants without k-anonymity

## Status
Accepted (2026-07)

## Context

The web app is being repurposed into a public, unauthenticated landing page
(showing active events and their current wants, to recruit volunteers to the
mobile app) plus a trimmed admin console. Two decisions fall out of this:

1. Today, any signed-in user can create an event (`POST /events`, gated only
   by `app.authenticate`); mobile has no equivalent create-event flow. Once
   the web app's regular-user flows are removed, only admins/moderators would
   be able to create events unless this were explicitly decided.
2. The public landing page needs to show "what does this event currently
   need" prominently and reliably, including for brand-new events with no
   real demand yet. The existing `computeDashboard` k-anonymizes demand
   (requires ≥3 distinct requesters behind a figure or it's null) — exactly
   the kind of privacy protection this app is built around (ADR context:
   avoiding inference of sensitive individual need in small groups).

## Decision

1. **Event creation becomes moderator/admin-only.** `POST /events` is
   role-gated to `moderator` (which also covers `admin` per the existing role
   hierarchy). No mobile equivalent is added in this pass. This is a
   deliberate, confirmed product decision, not an oversight.
2. **A new "public wants" concept, deliberately separate from
   `computeDashboard`, has no k-anonymity floor.** It merges admin-curated
   "current wants" (always shown, curated per event, ordered by the
   catalogue's `sortOrder`) with real aggregated demand from open requests,
   shown starting from a single requester. `computeDashboard` itself is
   unchanged for every other consumer.
3. **Event "deletion" in the admin UI reuses the existing `event_disable`
   moderation action** (already admin-gated, already cancels active matches
   and closes open requests) rather than a new hard database delete.

## Consequences

- Regular users lose the ability to create events via any client until/unless
  a future change adds it to mobile. This is accepted for now.
- The public wants view reveals demand for a category from a single
  requester — a real, deliberate reduction in the privacy margin
  `computeDashboard`'s k-anonymity gate provided elsewhere. Category-level
  aggregate counts don't reveal *who* requested; the product goal (visible
  real-time need to drive volunteer signups) was judged to outweigh this
  margin for this specific public-facing view.
- No event is ever hard-deleted; "deleted" events remain in the database with
  `status = 'disabled'`, preserving the audit trail and matching the rest of
  the system's soft-delete conventions.

## Reconsider when

- Event creation is added to mobile, at which point the moderator-only gate
  on `POST /events` should be revisited (either lifted, or replaced with a
  proper per-platform capability check).
- The single-requester demand disclosure is found to enable a real
  re-identification risk in practice (e.g. very small events where even a
  category-level signal narrows down who's present) — at which point a
  minimal floor (e.g. ≥2) should be reconsidered for this view specifically.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0012-admin-only-event-creation-and-public-wants.md
git commit -m "docs: add ADR-0012 for admin-only event creation and public wants"
```

---

### Task 7: Delete dead web pages/components and prune hooks

**Files:**
- Delete: `apps/web/src/pages/Home.tsx`, `MatchRoom.tsx`, `Settings.tsx`, `RequestFlow.tsx`, `Events.tsx`, `Profile.tsx`
- Delete: `apps/web/src/components/BringPanel.tsx`, `InventoryPanel.tsx`, `OfferSheet.tsx`, `RequestStatusCard.tsx`, `DashboardPanel.tsx`, `ReportDialog.tsx`
- Modify: `apps/web/src/api/hooks.ts`

**Interfaces:**
- Produces: nothing new. This task only removes dead code; Tasks 8-13 build the replacements.

- [ ] **Step 1: Delete the page and component files**

```bash
git rm apps/web/src/pages/Home.tsx apps/web/src/pages/MatchRoom.tsx apps/web/src/pages/Settings.tsx apps/web/src/pages/RequestFlow.tsx apps/web/src/pages/Events.tsx apps/web/src/pages/Profile.tsx
git rm apps/web/src/components/BringPanel.tsx apps/web/src/components/InventoryPanel.tsx apps/web/src/components/OfferSheet.tsx apps/web/src/components/RequestStatusCard.tsx apps/web/src/components/DashboardPanel.tsx apps/web/src/components/ReportDialog.tsx
```

Do NOT delete `apps/web/src/pages/Auth.tsx`, `apps/web/src/pages/CreateEvent.tsx`, `apps/web/src/pages/EventPage.tsx`, `apps/web/src/pages/Landing.tsx`, `apps/web/src/pages/NotFound.tsx`, `apps/web/src/pages/StaticPages.tsx`, `apps/web/src/pages/admin/*` — these all survive (some rewritten in later tasks).

At this point `apps/web/src/App.tsx`, `apps/web/src/pages/EventPage.tsx`, and `apps/web/src/components/AppShell.tsx` will fail to build because they still import the now-deleted files — this is EXPECTED. Do not fix those imports in this task; Tasks 8, 9, 10, 11 do that. Verify this specific, expected breakage with:

```bash
npm run typecheck -w apps/web
```

Expected: FAILS with "Cannot find module" errors pointing only at `App.tsx`'s imports of `HomePage`/`MatchRoomPage`/`SettingsPage`/`RequestFlowPage`/`EventsPage`/`ProfilePage`, `AppShell.tsx`'s import of `OfferSheet`, and `EventPage.tsx`'s imports of `BringPanel`/`DashboardPanel`/`InventoryPanel`/`ReportDialog`. If you see errors pointing anywhere else, stop and report — that indicates a file this plan didn't account for still depends on something deleted here.

- [ ] **Step 2: Prune dead hooks from `apps/web/src/api/hooks.ts`**

Run `grep -n "^export function use" apps/web/src/api/hooks.ts` to list every exported hook, then for each of the following names, delete its entire function body from the file (they are dead once the files in Step 1 are gone — do NOT delete any hook not in this exact list):

`useLogout` — **keep this one** (needed for the admin sign-out affordance in Task 8; do not delete despite the earlier research listing it among Settings-only hooks — verify by checking it isn't only imported from Settings.tsx, since Task 8 will newly consume it).

Delete: `useSessions`, `useRevokeSession`, `useEvents` (superseded by an equivalent used in Task 10 — check Task 10 before deleting; if Task 10 reintroduces a hook with this exact name, skip deleting it and instead treat Task 10 as modifying it), `useJoinEvent`, `useLeaveEvent`, `useEventDashboard`, `useBringSuggestions`, `useCatalogue` (verify first — Task 13's wants-picker UI likely needs this to list categories; if so, keep it), `useInventory`, `useAddInventory`, `useUpdateInventory`, `useDeleteInventory`, `useAvailability`, `useSetAvailability`, `useCreateRequest`, `useMyRequests`, `useRequest`, `useCancelRequest`, `useRenewRequest`, `useContinueRequest`, `usePendingOffers`, `useRespondOffer`, `useActiveMatches`, `useMatch`, `useMeetingUpdate`, `useCancelMatch`, `useConfirmCompletion`, `useConversation`, `useMessages`, `useSendMessage`, `useBlockUser`, `useBlocks`, `useNotificationPrefs`, `useUpdateNotificationPrefs`, `useNotifications`, `useConsents`, `useExportStatus`, `useStartExport`, `useDeleteAccount`, `useCreateReport`.

Keep (still needed): `useOtpStart`, `useOtpVerify`, `useMe`, `useUpdateMe`, `useCreateEvent`, `useEvent` (still used by the rewritten `EventPage.tsx` in Task 11), and every `useAdmin*`/`useEmergencyShutdown` hook.

After deleting, run `npm run typecheck -w apps/web` again — it's still expected to fail for the Step 1 reasons, but should NOT show any NEW errors caused by this step (e.g. "X is not exported" for a hook something still imports). If it does, you deleted a hook that's still used somewhere — restore it and re-check with a grep for its usage across `apps/web/src` before deleting again.

- [ ] **Step 3: Commit**

```bash
git add -A apps/web/src/pages apps/web/src/components apps/web/src/api/hooks.ts
git commit -m "chore(web): delete dead pages/components and prune unused API hooks"
```

---

### Task 8: Rewrite AppShell.tsx and App.tsx

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `useMe`, `useLogout` (survivors from Task 7).
- Produces: simplified nav; `RequireAuth` export removed (nothing uses it after this plan — `RequireModerator` is the only guard left in use).

- [ ] **Step 1: Rewrite `apps/web/src/components/AppShell.tsx`**

Replace the full file:

```tsx
/** App chrome: header, responsive nav, offline banner. */
import { useMemo, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';
import { getToken, clearToken } from '../api/client';
import { useLogout, useMe } from '../api/hooks';
import { useT } from '../i18n/LocaleContext';
import { useWsConnection, WsContext } from '../realtime/useWs';
import { Icon } from '../ui/icons';
import { LanguageToggle } from './LanguageToggle';
import { OfflineBanner } from './OfflineBanner';

function NavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink to={to} className="nav-item">
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const t = useT();
  const authed = !!getToken();
  const me = useMe(authed);
  const ws = useWsConnection(authed);
  const wsValue = useMemo(() => ({ connected: ws.connected }), [ws.connected]);
  const isModerator = me.data?.role === 'moderator' || me.data?.role === 'admin';
  const logout = useLogout();

  const items: { to: string; icon: string; label: string }[] = [];
  if (isModerator) items.push({ to: '/admin', icon: 'shield', label: t('nav.admin') });

  const signOut = () => {
    logout.mutate(undefined, { onSettled: () => clearToken() });
  };

  return (
    <WsContext.Provider value={wsValue}>
      <div className="app-shell">
        <a href="#main" className="skip-link">
          {t('nav.skipToContent')}
        </a>
        <header className="app-header">
          <div className="app-header-inner">
            <Link to="/" className="app-logo">
              <Icon name="heart" size={24} />
              <span>
                {t('common.appName')} <span lang="hi">सहाय</span>
              </span>
            </Link>
            <nav className="app-nav-desktop" aria-label={t('misc.menu')}>
              {items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
              <LanguageToggle />
              {authed ? (
                <button type="button" className="btn btn-secondary" onClick={signOut}>
                  {t('auth.logout')}
                </button>
              ) : (
                <Link to="/auth" className="btn btn-primary">
                  {t('nav.signIn')}
                </Link>
              )}
            </nav>
            <span className="spacer app-nav-mobile-spacer" style={{ flex: 1 }} />
            <span className="hide-desktop">
              <LanguageToggle />
            </span>
          </div>
        </header>
        <OfflineBanner />
        <main id="main" className="app-main">
          <Outlet />
        </main>
      </div>
    </WsContext.Provider>
  );
}

export function RequireModerator({ children }: { children: ReactNode }) {
  const t = useT();
  const me = useMe();
  if (!getToken()) return <Navigate to="/auth?next=%2Fadmin" replace />;
  if (me.isLoading) return <p className="text-soft">{t('common.loading')}</p>;
  if (me.data && me.data.role !== 'moderator' && me.data.role !== 'admin') {
    return (
      <div className="empty-state" role="alert">
        <h2>{t('errors.forbidden')}</h2>
      </div>
    );
  }
  return <>{children}</>;
}
```

Note: `useLocation` is no longer used (it was only for `RequireAuth`'s redirect-back `next` param) — it's correctly dropped from the import list above. Check `apps/web/src/api/client.ts` exports `clearToken` (it's referenced by the existing `AuthProvider`-equivalent pattern elsewhere in this codebase — verify via `grep -n "export function clearToken" apps/web/src/api/client.ts`; if the exact name differs, use whatever the file actually exports for clearing the stored token).

The mobile bottom nav (`app-nav-mobile`) is removed entirely — with no authenticated user-facing nav items left (home/events/profile/settings all deleted), a duplicate bottom nav has nothing useful to show; the single admin link (when present) and sign-in/out live in the header only. This CSS class becoming unused in `global.css` is acceptable — do not remove the CSS rule itself in this task (out of scope; a future design-system pass can prune unused CSS).

- [ ] **Step 2: Update `apps/web/src/App.tsx`**

Replace the full file:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ApiClientError } from './api/client';
import { AppShell, RequireModerator } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocaleProvider } from './i18n/LocaleContext';
import { AdminPage } from './pages/admin/AdminPage';
import { AuthPage } from './pages/Auth';
import { EventPage } from './pages/EventPage';
import { LandingPage } from './pages/Landing';
import { NotFoundPage } from './pages/NotFound';
import { GuidelinesPage, PrivacyPage, SupportPage, TermsPage } from './pages/StaticPages';
import { ToastProvider } from './ui/Toast';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Weak-network defaults: retry transient failures with backoff, never retry 4xx.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 10_000,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ErrorBoundary>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/guidelines" element={<GuidelinesPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/support" element={<SupportPage />} />
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/events/:idOrCode" element={<EventPage />} />
                  <Route
                    path="/admin"
                    element={
                      <RequireModerator>
                        <AdminPage />
                      </RequireModerator>
                    }
                  />
                  <Route
                    path="/admin/:section"
                    element={
                      <RequireModerator>
                        <AdminPage />
                      </RequireModerator>
                    }
                  />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 3: Verify expected remaining failures**

Run: `npm run typecheck -w apps/web`
Expected: still FAILS, but now ONLY for `EventPage.tsx`'s imports of `BringPanel`/`DashboardPanel`/`InventoryPanel`/`ReportDialog` (Task 11 fixes this) and for `Landing.tsx` not yet exporting what `App.tsx` needs if Task 10 hasn't landed yet — if you're executing tasks in order, Task 9/10 haven't run yet, so `Landing.tsx` still exists in its old form and should still export `LandingPage`, so this shouldn't newly break; confirm by reading the error output carefully. If `AdminPage`/`AuthPage`/`EventPage`/`NotFoundPage`/`StaticPages` imports break, investigate — they shouldn't, since none of those files were touched.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AppShell.tsx apps/web/src/App.tsx
git commit -m "feat(web): simplify AppShell nav and trim App.tsx routes"
```

---

### Task 9: New `PublicWants` and `VolunteerCta` components

**Files:**
- Create: `apps/web/src/components/PublicWants.tsx`
- Create: `apps/web/src/components/VolunteerCta.tsx`

**Interfaces:**
- Consumes: `PublicWant` type (Task 2), `CategoryChip`/`Badge`/`Icon` from `apps/web/src/ui/patterns.tsx`/`components.tsx`/`icons.tsx`, `useCatalogue` (Task 7 — verify it was kept) for resolving a category slug to its display name/icon/group.
- Produces: `<PublicWants wants={PublicWant[]} />`, `<VolunteerCta />`.

- [ ] **Step 1: Check catalogue lookup availability**

Run `grep -n "export function useCatalogue" -A 8 apps/web/src/api/hooks.ts` to confirm it's still present (Task 7 was instructed to keep it if needed here — if it was deleted, restore it now; it fetches `GET /catalogue` returning `{ categories: Category[] }` where each `Category` has `slug`, `name` (localized per-request already, per `mapCategory`), `icon`, `group`).

- [ ] **Step 2: Implement `apps/web/src/components/PublicWants.tsx`**

```tsx
import type { PublicWant } from '@sahay/shared';
import { useCatalogue } from '../api/hooks';
import { useLocale } from '../i18n/LocaleContext';
import { Badge, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';
import { CategoryChip } from '../ui/patterns';

export function PublicWants({ wants }: { wants: PublicWant[] }) {
  const { t } = useLocale();
  const catalogue = useCatalogue();

  if (catalogue.isLoading) return <SkeletonCard lines={2} />;
  if (wants.length === 0) return <p className="text-sm text-soft">{t('eventPage.wantsEmpty')}</p>;

  const byslug = new Map((catalogue.data?.categories ?? []).map((c) => [c.slug, c]));

  return (
    <div className="row-wrap">
      {wants.map((w) => {
        const cat = byslug.get(w.categorySlug);
        if (!cat) return null;
        return (
          <span key={w.categorySlug} className="chip" style={{ alignItems: 'center', gap: 'var(--sp-1)' }}>
            <CategoryChip group={cat.group} icon={cat.icon} size="sm" />
            <span>{cat.name}</span>
            {w.source === 'admin' ? (
              <Badge tone="ok" aria-label={t('eventPage.wantAdminBadge')}>
                <Icon name="check" size={12} label={t('eventPage.wantAdminBadge')} />
              </Badge>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
```

Check `Category['name']`'s actual type before assuming `cat.name` is a plain string — per earlier research, `mapCategory` returns `name: row.name as Record<Locale, string>` (a localized MAP, not a resolved string) in the server's internal `Category` type, but confirm what the `/catalogue` HTTP response actually serializes by checking `packages/shared/src/schemas.ts`'s `zCategory` — if the wire type is the full `Record<Locale,string>` map, change `cat.name` above to `cat.name[locale]` (destructure `locale` from `useLocale()` alongside `t`) instead of a bare string.

- [ ] **Step 3: Implement `apps/web/src/components/VolunteerCta.tsx`**

```tsx
import { useLocale } from '../i18n/LocaleContext';
import { IllustrationVignette } from '../ui/patterns';

export function VolunteerCta() {
  const { t } = useLocale();
  return (
    <section className="card-lg stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <IllustrationVignette name="parcel-hands" size={96} />
      <h2 style={{ margin: 0 }}>{t('landing.volunteerTitle')}</h2>
      <p className="text-soft" style={{ maxWidth: '44ch', margin: 0 }}>
        {t('landing.volunteerBody')}
      </p>
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        <span className="btn btn-secondary" aria-disabled="true">
          {t('landing.appStoreBadge')}
        </span>
        <span className="btn btn-secondary" aria-disabled="true">
          {t('landing.playStoreBadge')}
        </span>
      </div>
    </section>
  );
}
```

These are placeholder badges (`<span>`, not `<a>`) since there are no live store links yet, per the confirmed design decision — do not make them clickable links to nowhere.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: these two new files introduce no new errors (existing expected failures from Tasks 7/8 remain until Tasks 10/11 land).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PublicWants.tsx apps/web/src/components/VolunteerCta.tsx
git commit -m "feat(web): add PublicWants and VolunteerCta components"
```

---

### Task 10: Rewrite `Landing.tsx` as the public event list

**Files:**
- Modify: `apps/web/src/pages/Landing.tsx`
- Modify: `apps/web/src/api/hooks.ts` (restore/adjust `useEvents` if Task 7 removed it — this task is its real consumer now)

**Interfaces:**
- Consumes: `PublicWants`, `VolunteerCta` (Task 9), `EventSummary.wants` (Task 4), `useEvents` hook.
- Produces: `LandingPage` rendering a public event list.

- [ ] **Step 1: Read the current file first**

Run `cat apps/web/src/pages/Landing.tsx` to see its exact current marketing content (hero, value rows, "how it works", limits/privacy banners, install blurb) — this plan reuses that intro content above the new event list rather than discarding it. Also run `cat apps/web/src/api/hooks.ts | grep -n "useEvents" -A 10` — if Task 7 deleted `useEvents`, re-add it exactly as it was (it already exists per earlier research: `useQuery({ queryKey: ['events', params], queryFn: () => api<{ items: EventSummary[]; nextCursor?: string | null }>('/events', { query: {...} }) })`); if it's still present, use it as-is.

- [ ] **Step 2: Implement the new `apps/web/src/pages/Landing.tsx`**

```tsx
/** Public landing: intro + a live list of currently-active public events and their top wants. */
import { Link } from 'react-router-dom';
import { useEvents } from '../api/hooks';
import { VolunteerCta } from '../components/VolunteerCta';
import { PublicWants } from '../components/PublicWants';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { Card, EmptyState, SkeletonCard } from '../ui/components';
import { IllustrationVignette } from '../ui/patterns';

export function LandingPage() {
  const { t, locale } = useLocale();
  const events = useEvents({});

  return (
    <div className="stack app-col">
      <div className="celebrate" style={{ padding: 'var(--sp-4) 0' }}>
        <IllustrationVignette name="parcel-hands" size={128} />
        <h1 style={{ margin: 0 }}>{t('landing.heroTitle')}</h1>
        <p className="text-soft" style={{ maxWidth: '48ch', margin: 0 }}>
          {t('landing.heroBody')}
        </p>
      </div>

      <h2>{t('nav.events')}</h2>
      {events.isLoading ? (
        <div className="stack">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      ) : (events.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('landing.noActiveEvents')} />
      ) : (
        <div className="stack">
          {events.data!.items.map((ev) => (
            <Link key={ev.id} to={`/events/${ev.code}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <Card className="card-lg">
                <div className="stack-sm">
                  <div className="row">
                    <strong style={{ flex: 1, fontSize: 'var(--fs-lg)' }}>{ev.title}</strong>
                  </div>
                  <p className="text-xs text-soft" style={{ margin: 0 }}>
                    {ev.areaLabel} · {formatDateTime(ev.startsAt, locale)}
                  </p>
                  <PublicWants wants={ev.wants} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <VolunteerCta />
    </div>
  );
}
```

Preserve any additional marketing sections you saw in Step 1 (limits/privacy banners, "how it works") that you judge still make sense for an anonymous visitor — insert them between the hero and the event list, reusing the exact same `t('landing.*')` keys already in the file today (they still exist; this plan didn't remove them). Use your judgment on ordering, but do not remove the event list or the `VolunteerCta` — those are this task's core deliverable.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: `Landing.tsx`-related errors gone; only `EventPage.tsx`'s errors (Task 11) remain.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Landing.tsx apps/web/src/api/hooks.ts
git commit -m "feat(web): rewrite landing page as a public event list with top wants"
```

---

### Task 11: Rewrite `EventPage.tsx` as a fully public detail view

**Files:**
- Modify: `apps/web/src/pages/EventPage.tsx`

**Interfaces:**
- Consumes: `useEvent` (survivor), `PublicWants`, `VolunteerCta` (Task 9).
- Produces: public, read-only event detail — no join/leave/report/bring/supplies/request UI.

- [ ] **Step 1: Implement**

Replace the full file:

```tsx
/** Public event detail: description, safety/medical info, notices, current wants, volunteer CTA. */
import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/hooks';
import { PublicWants } from '../components/PublicWants';
import { VolunteerCta } from '../components/VolunteerCta';
import { useLocale } from '../i18n/LocaleContext';
import { formatDateTime } from '../lib/format';
import { Badge, Banner, Card, SkeletonCard } from '../ui/components';
import { Icon } from '../ui/icons';

export function EventPage() {
  const { idOrCode } = useParams<{ idOrCode: string }>();
  const { t, locale } = useLocale();
  const eventQuery = useEvent(idOrCode);
  const event = eventQuery.data;

  if (eventQuery.isLoading) {
    return (
      <div className="stack">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="empty-state">
        <h1>{t('errors.not_found')}</h1>
        <Link className="btn btn-secondary" to="/">
          {t('nav.events')}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="stack-sm">
        <div className="row">
          <h1 style={{ margin: 0, flex: 1 }}>{event.title}</h1>
          {event.status === 'active' ? <Badge tone="ok">{t('events.active')}</Badge> : null}
          {event.status === 'scheduled' ? <Badge tone="accent">{t('events.scheduled')}</Badge> : null}
          {['completed', 'archived', 'disabled'].includes(event.status) ? <Badge>{t('events.ended')}</Badge> : null}
        </div>
        <div className="stack-sm">
          <p className="helping-meta">
            <Icon name="calendar" size={16} /> {t(`eventTypes.${event.type}`)} · {t('eventPage.starts')}:{' '}
            {formatDateTime(event.startsAt, locale)} · {t('eventPage.ends')}: {formatDateTime(event.endsAt, locale)}
          </p>
          <p className="helping-meta">
            <Icon name="location" size={16} /> {event.areaLabel}
          </p>
        </div>
      </div>

      {event.notices.length > 0 ? (
        <section aria-label={t('home.notices')} className="stack-sm">
          {event.notices.map((n) => (
            <Banner key={n.id} tone="warn" icon="info" role="status">
              <p style={{ margin: 0 }}>{n.body}</p>
              <span className="caption">{formatDateTime(n.createdAt, locale)}</span>
            </Banner>
          ))}
        </section>
      ) : null}

      <Card>
        <h2>{t('eventPage.aboutTitle')}</h2>
        <p className="text-soft" style={{ marginBottom: 0 }}>
          {event.description}
        </p>
      </Card>

      {event.safetyInfo ? (
        <Card>
          <h2>{t('eventPage.safetyTitle')}</h2>
          <p className="text-soft" style={{ marginBottom: 0 }}>
            {event.safetyInfo}
          </p>
        </Card>
      ) : null}

      {event.medicalInfo ? (
        <Banner tone="danger" icon="warning">
          <strong>{t('eventPage.medicalTitle')}</strong>
          <p style={{ marginBottom: 0 }}>{event.medicalInfo}</p>
        </Banner>
      ) : null}

      <Card>
        <h2>{t('eventPage.wantsTitle')}</h2>
        <PublicWants wants={event.wants} />
      </Card>

      <VolunteerCta />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: exits 0 — this was the last file with pending expected errors from Tasks 7/8.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/EventPage.tsx
git commit -m "feat(web): rewrite event detail page as fully public and read-only"
```

---

### Task 12: Admin event create/delete UI

**Files:**
- Modify: `apps/web/src/pages/admin/AdminPage.tsx`
- Modify: `apps/web/src/pages/CreateEvent.tsx` (relocate under admin)
- Modify: `apps/web/src/App.tsx` (add the create-event admin route)

**Interfaces:**
- Consumes: `useCreateEvent` (survivor), `ModerateDialog` (existing, reused for the delete action).

- [ ] **Step 1: Add an admin create-event route**

In `apps/web/src/App.tsx`, add the import `import { CreateEventPage } from './pages/CreateEvent';` and a new route nested under the admin guard, right after the `/admin/:section` route:

```tsx
                  <Route
                    path="/admin/events/new"
                    element={
                      <RequireModerator>
                        <CreateEventPage />
                      </RequireModerator>
                    }
                  />
```

- [ ] **Step 2: Adjust `CreateEventPage`'s success redirect**

In `apps/web/src/pages/CreateEvent.tsx`, the success screen currently links to `/events/${event.code}` — this is fine, it survives unchanged (`/events/:idOrCode` still exists and is now the public detail page, so an admin can immediately view the created event there). No code change needed in this file beyond a read-through to confirm nothing else in it references a now-deleted page/hook — run `grep -n "^import" apps/web/src/pages/CreateEvent.tsx` and confirm every import target still exists.

- [ ] **Step 3: Add a link to the create-event page and a delete action in `AdminPage.tsx`'s `EventsSection`**

In `apps/web/src/pages/admin/AdminPage.tsx`, add the import `import { Link } from 'react-router-dom';` (if not already present — check first) and inside `EventsSection`, add a link near the top of the returned JSX (right after the opening `<div className="stack">`):

```tsx
      <Link to="/admin/events/new" className="btn btn-primary">
        {t('admin.createEvent')}
      </Link>
```

Add a "Delete" button alongside the existing "Emergency"/`event_disable` button — check the current code: per earlier research, the existing "Emergency" button ALREADY calls `setTarget({ action: 'event_disable', targetEventId: ev.id, label: t('admin.emergency') })`. Since this plan's design decision is that "delete" reuses this exact action, simply relabel that existing button rather than adding a second one — replace:

```tsx
                <Button
                  variant="destructive"
                  onClick={() => setTarget({ action: 'event_disable', targetEventId: ev.id, label: t('admin.emergency') })}
                >
                  {t('admin.emergency')}
                </Button>
```

with:

```tsx
                <Button
                  variant="destructive"
                  onClick={() => setTarget({ action: 'event_disable', targetEventId: ev.id, label: t('admin.deleteEvent') })}
                >
                  {t('admin.deleteEvent')}
                </Button>
```

(This reuses the exact same `ModerateDialog`/`event_disable` flow already wired up — the dialog already requires a written reason per the existing moderation-action pattern, satisfying "written-reason-required admin actions" from the system's design. No new server call, no new dialog.)

- [ ] **Step 4: Toggle "pending approval only" default**

Since admin now creates events directly (often `unlisted`, not `public`), the `EventsSection`'s default filter (`pendingOnly = true`, i.e. `useState(true)`) would hide freshly-created unlisted/private events from the default admin view. Change the initial state:

```tsx
  const [pendingOnly, setPendingOnly] = useState(false);
```

- [ ] **Step 5: Typecheck and manually sanity-check**

Run: `npm run typecheck -w apps/web`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/admin/AdminPage.tsx apps/web/src/pages/CreateEvent.tsx
git commit -m "feat(web): add admin create-event route and relabel delete action"
```

---

### Task 13: Admin wants-management UI

**Files:**
- Modify: `apps/web/src/pages/admin/AdminPage.tsx`
- Modify: `apps/web/src/api/hooks.ts`

**Interfaces:**
- Consumes: `zAdminEventWants` (Task 2), `PATCH /admin/events/:id/wants` (Task 5), `useCatalogue` (survivor).
- Produces: `useAdminSetWants` hook; a "Manage wants" dialog in `EventsSection`.

- [ ] **Step 1: Add the hook**

In `apps/web/src/api/hooks.ts`, add near the other `useAdmin*` hooks:

```ts
export function useAdminSetWants(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categorySlugs: string[]) =>
      api<{ ok: boolean }>(`/admin/events/${eventId}/wants`, { method: 'PATCH', body: { categorySlugs } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['event', eventId] });
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}
```

Check the exact `api()` helper's call signature for a PATCH request first (`grep -n "method: 'PATCH'" apps/web/src/api/hooks.ts` — the existing `useAdminNotice`/similar hooks show the pattern; match it exactly, e.g. some other admin PATCH hooks in this file may pass `method` differently).

- [ ] **Step 2: Add a wants-editing dialog to `EventsSection`**

In `apps/web/src/pages/admin/AdminPage.tsx`'s `EventsSection`, add state and a dialog. Add near the other `useState` calls at the top of `EventsSection`:

```tsx
  const [wantsFor, setWantsFor] = useState<{ id: string; current: string[] } | null>(null);
```

You'll need each event's currently-declared admin want slugs to prefill the dialog — the `useAdminEvents` list response (`AdminEventView` or similar type) may not currently include this. Check `packages/shared/src/schemas.ts`'s admin event list type (search for what `listAdminEvents` in `server/src/modules/admin/service.ts` actually returns) — if it doesn't include admin-declared want slugs, extend it: add `adminWantSlugs: string[]` to that server-side mapping (query `event_categories` joined to `categories` filtered `adminWant = true` for each listed event, similar to the pattern in `wants.ts`) and to its corresponding Zod schema, so the admin events list carries this data without an extra round trip per event. This is a small, in-scope extension — implement it if the field is missing rather than skipping the prefill.

Add a "Manage wants" button next to the existing "Publish notice" button:

```tsx
                <Button variant="secondary" onClick={() => setWantsFor({ id: ev.id, current: ev.adminWantSlugs ?? [] })}>
                  {t('admin.manageWants')}
                </Button>
```

Add the dialog itself (a new small component in the same file, below `EventsSection`, or inline — use your judgment on whether it's clean enough inline or deserves its own function; if the file is already large, extract it as `WantsDialog`):

```tsx
function WantsDialog({
  target,
  onClose,
}: {
  target: { id: string; current: string[] } | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const catalogue = useAdminCategories(); // check exact hook name via grep — may be useCatalogue or an admin-specific variant
  const setWants = useAdminSetWants(target?.id ?? '');
  const [selected, setSelected] = useState<string[]>(target?.current ?? []);

  if (!target) return null;

  const toggle = (slug: string) => {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  return (
    <Dialog open={!!target} onClose={onClose} title={t('admin.manageWants')}>
      <div className="stack">
        <p className="text-sm text-soft">{t('admin.wantsHint')}</p>
        <div className="row-wrap">
          {(catalogue.data?.categories ?? []).map((c) => (
            <button
              key={c.slug}
              type="button"
              role="checkbox"
              aria-checked={selected.includes(c.slug)}
              className="chip"
              onClick={() => toggle(c.slug)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <Button
          block
          loading={setWants.isPending}
          onClick={() =>
            setWants.mutate(selected, {
              onSuccess: () => {
                toast(t('sync.submitted'));
                onClose();
              },
              onError: () => toast(t('common.error'), 'error'),
            })
          }
        >
          {t('common.ok')}
        </Button>
      </div>
    </Dialog>
  );
}
```

Render it inside `EventsSection`'s return, alongside the existing `<ModerateDialog .../>`:

```tsx
      <WantsDialog target={wantsFor} onClose={() => setWantsFor(null)} />
```

Check `c.name`'s actual type here too (same concern as Task 9's `PublicWants.tsx`) — admin's own locale context applies the same way; use `c.name[locale]` if `name` is a localized map rather than a resolved string, destructuring `locale` from `useLocale()`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/admin/AdminPage.tsx apps/web/src/api/hooks.ts
git commit -m "feat(web): add admin wants-management dialog"
```

---

### Task 14: Delete obsolete e2e specs; update surviving ones

**Files:**
- Delete: `apps/web/e2e/01-core-loop.spec.ts`, `02-decline-timeout.spec.ts`, `03-partial-and-continue.spec.ts`, `04-cancel-renew-expire.spec.ts`, `05-safety.spec.ts`, `07-settings-privacy.spec.ts`, `08-offline.spec.ts`
- Modify: `apps/web/e2e/00-setup.spec.ts`, `06-admin.spec.ts`, `helpers.ts`

**Interfaces:**
- Produces: an organizer fixture with `admin` role (Task 4 requires event creation to be moderator/admin-tier).

- [ ] **Step 1: Delete the obsolete specs**

```bash
git rm apps/web/e2e/01-core-loop.spec.ts apps/web/e2e/02-decline-timeout.spec.ts apps/web/e2e/03-partial-and-continue.spec.ts apps/web/e2e/04-cancel-renew-expire.spec.ts apps/web/e2e/05-safety.spec.ts apps/web/e2e/07-settings-privacy.spec.ts apps/web/e2e/08-offline.spec.ts
```

- [ ] **Step 2: Update `00-setup.spec.ts`'s organizer to admin role**

Read the full current file first (`cat apps/web/e2e/00-setup.spec.ts`). The `loginViaApi(request, ORGANIZER_EMAIL)` call creates a regular user via OTP signup — regular signups get `role: 'user'` by default, but Task 4 now requires `moderator` role to call `POST /events`.

There is no test-only HTTP endpoint for role promotion, and this plan does not add one (an unguarded role-promotion route would be a real production security hole). Instead, use the same direct-`pg`-access pattern `apps/web/e2e/global-setup.ts` already uses (it connects straight to `DATABASE_URL` with the `pg` package for truncation/seeding). Add a helper to `apps/web/e2e/helpers.ts`:

```ts
import pg from 'pg';
import { DATABASE_URL } from './env';

export async function promoteToAdmin(userId: string): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', userId]);
  } finally {
    await client.end();
  }
}
```

(Check `apps/web/e2e/helpers.ts`'s existing imports first — `pg` and `DATABASE_URL` may already be imported for another purpose; reuse rather than duplicate the import if so.)

In `00-setup.spec.ts`, after `const organizer = await loginViaApi(request, ORGANIZER_EMAIL);`, add:

```ts
await promoteToAdmin(organizer.user.id);
```

before the `POST /events` call that creates the shared fixture event — this must run before that call, since it's what makes the subsequent creation succeed under Task 4's new role gate.

- [ ] **Step 3: Update `06-admin.spec.ts`**

Read the full current file. Remove the sub-test `'pausing the event blocks new requests with a clear error; unpause restores'` (or the portion of it that submits a request via `RequestFlow`/`POST /events/:id/request` — check its exact body first) since the request flow no longer exists on web. If the test also verifies something about pause/unpause that doesn't depend on the request flow (e.g. checking the event's `matchingPaused` field via the admin API directly), keep that part and only remove the now-impossible UI-driven request submission.

Add a new assertion (in the same file or a new `it`) that after `admin approves a pending public event`, the event appears in the PUBLIC landing list (`GET /events` via `apiRaw`, or a UI check on `/`) with the correct fields — this is a natural extension of existing coverage now that `/` is the discovery surface instead of the old `/events` page.

- [ ] **Step 4: Run the surviving e2e specs**

Run: `npm run test:e2e -w apps/web -- 00-setup 06-admin` (check the exact partial-run syntax this project's `playwright.config.ts` supports — per earlier session context, `npx playwright test <spec-name-fragment>` works from `apps/web`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/e2e
git commit -m "test(e2e): remove specs for deleted flows, adapt setup/admin specs"
```

---

### Task 15: New public-landing e2e spec

**Files:**
- Create: `apps/web/e2e/09-public-landing.spec.ts`

**Interfaces:**
- Consumes: the shared event fixture from `00-setup.spec.ts` (`readState()` per existing convention).

- [ ] **Step 1: Write the spec**

Read `apps/web/e2e/00-setup.spec.ts` and one simple existing spec (e.g. what remains of `06-admin.spec.ts`) first, to match this codebase's exact `readState()`/fixture-reuse conventions. Then write:

```ts
/**
 * Public landing: anonymous visitors see active, approved-public events with
 * their top wants, can click into full event detail, and see the volunteer CTA.
 * No login is used anywhere in this spec.
 */
import { expect, test } from '@playwright/test';
import { readState } from './helpers'; // check exact helper name/shape via grep

test('anonymous visitor sees the event on the landing page with its top wants', async ({ page }) => {
  const { eventCode, eventTitle } = readState(); // adjust to whatever 00-setup.spec.ts actually persists
  await page.goto('/');
  await expect(page.getByText(eventTitle)).toBeVisible();
  // Volunteer CTA is present without any login.
  await expect(page.getByText('Become a Sahay volunteer')).toBeVisible(); // match exact i18n string from Task 2

  await page.getByText(eventTitle).click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventCode}`));
  await expect(page.getByRole('heading', { name: 'What this event needs' })).toBeVisible(); // match Task 2's exact string
});

test('signing in is not required to view any public page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  // No redirect to /auth happens just from visiting the landing or an event page.
  await expect(page).toHaveURL('/');
});
```

Adjust the exact `getByText`/`getByRole` strings to match whatever the real rendered copy is once Tasks 9-11 have landed (read the actual component source rather than guessing if anything here doesn't match).

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -w apps/web -- 09-public-landing`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/09-public-landing.spec.ts
git commit -m "test(e2e): add public landing coverage"
```

---

## Final verification

- [ ] Run the full test matrix:

```bash
npm run typecheck -w server
npm run typecheck -w packages/shared
npm run typecheck -w apps/web
npm test -w server
npm run test:integration -w server
npm test -w packages/shared
npm run test:e2e -w apps/web
```

Expected: all green.

- [ ] Grep for dead references:

```bash
grep -rn "OfferSheet\|BringPanel\|DashboardPanel\|InventoryPanel\|RequestStatusCard\|ReportDialog" apps/web/src
grep -rn "'/home'\|'/matches\|'/settings'\|'/profile'\|'/events/new'\|'/events/.*request'" apps/web/src
```

Expected: no output (everything removed/rewired in Tasks 7-13).
