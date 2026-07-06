-- The election list view runs `SELECT * FROM oe_elections ORDER BY created_at DESC`
-- on every load (index.html). `created_at` is plaintext (the `_at` suffix is in the
-- encryption skip-list), so it can be sorted in SQL — but without an index the sort
-- is a full scan. Negligible at family size, but this app targets org/HOA scale
-- (hundreds of elections over time), so index the sort column.
CREATE INDEX IF NOT EXISTS oe_elections_created_at ON app_officer_elections__oe_elections(created_at);
