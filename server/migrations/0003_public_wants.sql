-- Admin-curated "current wants" for the public landing page. Ordering among
-- admin-declared wants uses the existing categories.sort_order — no new
-- per-event ordering column needed.

ALTER TABLE event_categories
  ADD COLUMN admin_want boolean NOT NULL DEFAULT false;
