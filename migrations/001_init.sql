CREATE TABLE IF NOT EXISTS app_officer_elections__oe_elections (
  id                    TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS app_officer_elections__oe_candidates (
  id           TEXT PRIMARY KEY,
  election_id  TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  statement    TEXT NOT NULL DEFAULT '',
  nominated_by TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (election_id, member_id)
);

-- Ballots are intentionally NOT linked to a voter: this table holds only the
-- anonymous cast ballot (paired with oe_ballot_items for selections). Whether
-- a member has voted is tracked separately in oe_ballot_receipts, which has
-- no link back to oe_ballots/oe_ballot_items — so no query can join a voter's
-- identity to their selections.
CREATE TABLE IF NOT EXISTS app_officer_elections__oe_ballots (
  id           TEXT PRIMARY KEY,
  election_id  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_officer_elections__oe_ballot_items (
  id           TEXT PRIMARY KEY,
  ballot_id    TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  rank         INTEGER NOT NULL DEFAULT 1
);

-- Records that a member has voted in an election ("one ballot per member"),
-- without linking to the ballot they cast.
CREATE TABLE IF NOT EXISTS app_officer_elections__oe_ballot_receipts (
  election_id  TEXT NOT NULL,
  voter_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (election_id, voter_id)
);

CREATE INDEX IF NOT EXISTS oe_candidates_election ON app_officer_elections__oe_candidates(election_id);
CREATE INDEX IF NOT EXISTS oe_ballots_election    ON app_officer_elections__oe_ballots(election_id);
CREATE INDEX IF NOT EXISTS oe_ballot_items_ballot ON app_officer_elections__oe_ballot_items(ballot_id);
