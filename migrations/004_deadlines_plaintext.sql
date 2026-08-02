-- Store the two election deadlines in plaintext so SQL can compare them.
--
-- `voting_deadline` and `nominations_deadline` were encrypted at rest: the
-- platform's skip-list (app-db-codec.ts) covers the suffixes `_id`, `_at`,
-- `_date` and `_by`, and `_deadline` matches none of them. Encryption uses a
-- random IV, so equality against a ciphertext column never matches — which made
-- the deadlines display-only and left this app unable to declare a Today
-- (`agenda`) surface at all. They are now listed in the manifest's
-- `db_plaintext_columns`.
--
-- Safe to do in place because this app has no installs, so there are no
-- existing ciphertext rows to migrate. If that ever changes, an app with live
-- data needs a decrypt-and-rewrite pass instead of this note.
--
-- A deadline is a `datetime-local` value (`YYYY-MM-DDTHH:MM`), so the agenda
-- matches on `substr(voting_deadline, 1, 10) = :today`. The index leads with
-- `status` because the agenda filters the phase first and only a handful of
-- elections are ever in a live phase at once.
CREATE INDEX IF NOT EXISTS oe_elections_status_voting_deadline
  ON app_officer_elections__oe_elections (status, voting_deadline);

CREATE INDEX IF NOT EXISTS oe_elections_status_nominations_deadline
  ON app_officer_elections__oe_elections (status, nominations_deadline);
