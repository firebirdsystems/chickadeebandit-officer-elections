CREATE TABLE IF NOT EXISTS oe_elections (
  id                    TEXT PRIMARY KEY,
  household_id          UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  title                 TEXT NOT NULL,
  office                TEXT NOT NULL,
  voting_method         TEXT NOT NULL DEFAULT 'majority',
  has_nominations       INTEGER NOT NULL DEFAULT 1,
  nominations_deadline  TEXT,
  voting_deadline       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'nominations',
  term_label            TEXT NOT NULL DEFAULT '',
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  certified_by          TEXT,
  certified_at          TEXT
);

CREATE TABLE IF NOT EXISTS oe_candidates (
  id           TEXT PRIMARY KEY,
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  election_id  TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  statement    TEXT NOT NULL DEFAULT '',
  nominated_by TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(household_id, election_id, member_id)
);

CREATE TABLE IF NOT EXISTS oe_ballots (
  id           TEXT PRIMARY KEY,
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  election_id  TEXT NOT NULL,
  voter_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(household_id, election_id, voter_id)
);

CREATE TABLE IF NOT EXISTS oe_ballot_items (
  id           TEXT PRIMARY KEY,
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  ballot_id    TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  rank         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS oe_elections_household ON oe_elections(household_id);
CREATE INDEX IF NOT EXISTS oe_candidates_election ON oe_candidates(election_id);
CREATE INDEX IF NOT EXISTS oe_ballots_election    ON oe_ballots(election_id);
CREATE INDEX IF NOT EXISTS oe_ballot_items_ballot ON oe_ballot_items(ballot_id);
