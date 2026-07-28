-- Admin-declared "current wants" for the public landing page, in a table
-- separate from event_categories — event_categories.admin_want (added in
-- 0003) turned out to collide with effectiveEventCategories' override
-- semantics: any row there switches an event from "all categories allowed"
-- to "only these categories allowed," which is NOT what "admin want" means.

CREATE TABLE event_admin_wants (
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, category_id)
);

ALTER TABLE event_categories DROP COLUMN admin_want;
