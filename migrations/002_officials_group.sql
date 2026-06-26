-- Election governance is now gated to a configured "election officials" group
-- instead of "any adult". Two pieces:
--
-- 1. A key/value `settings` table holding the `officials_group_id` pointer. It
--    carries the `app_config` row policy (read-all, write-none-via-app): the only
--    writer is the admin-gated POST /api/admin-config endpoint, so no member can
--    crown their own group via direct SQL. This is the trust root for "who runs
--    elections" (same pattern as dues-contributions / reserve-fund / document-library).
--
-- 2. A plaintext `visibility` column on elections and candidates so they can carry
--    an `owner_or_visibility` policy: everyone reads (visibility = 'everyone'),
--    only the configured officials group may INSERT/UPDATE/DELETE
--    (`write_privileged_only`). `visibility` is in the platform encryption
--    skip-list, so the policy compares it correctly. Existing rows default to
--    'everyone' — no read regression. Until an admin sets the group, ALL writes
--    are rejected server-side (isPrivileged is false for everyone), so the client
--    disables management until the group is configured.

CREATE TABLE IF NOT EXISTS app_officer_elections__settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE app_officer_elections__oe_elections  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE app_officer_elections__oe_candidates ADD COLUMN visibility TEXT NOT NULL DEFAULT 'everyone';

-- The owner_or_visibility read filter rewrites to
-- `WHERE <member_column> = ? OR visibility IN (...)`; index the owner columns so
-- the owner-scoped branch stays cheap at org scale.
CREATE INDEX IF NOT EXISTS oe_elections_created_by   ON app_officer_elections__oe_elections(created_by);
CREATE INDEX IF NOT EXISTS oe_candidates_nominated_by ON app_officer_elections__oe_candidates(nominated_by);
