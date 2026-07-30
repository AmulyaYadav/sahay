-- Localized plural names, so a counted want reads "40 torches needed" rather
-- than "40 Torch needed". Nullable: absent means "no distinct plural" and
-- callers fall back to `name`. That is the right answer for already-plural
-- entries (Biscuits, Sanitary pads), for mass nouns (Fruit, Soap, Stationery),
-- and for admin-created categories that never get a plural filled in.
--
-- Populated for the default catalogue by seedCatalogue(), which upserts
-- seed-managed fields by slug — running `npm run db:seed -w server` backfills
-- an existing database.
ALTER TABLE categories ADD COLUMN name_plural jsonb;
