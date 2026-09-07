export { memberColor, initial, esc, isAdult, formatRelativeDate } from "./shared.js";

/**
 * Whether `me` may manage elections and candidates — mirrors the server-side
 * `write_privileged_only` policy on oe_elections / oe_candidates, which is gated
 * by the configured "election officials" group (officials_group_id).
 *
 * MUST match the hub's privileged resolution exactly: privileged IFF the group
 * is configured, still exists, and the member is in it. There is NO "all adults"
 * fallback when the group is unset or dangling — the hub rejects every privileged
 * write in that state, so management stays disabled here too (otherwise every
 * action would be a silent 403). See __tests__/helpers/privileged-gate.mjs.
 *
 * @param {object|null} me
 * @param {Array}  groups
 * @param {string|null} officialsGroupId
 */
export function canManageElections(me, groups, officialsGroupId) {
  if (!me || !officialsGroupId) return false;
  const g = groups.find(g => g.id === officialsGroupId);
  return !!g && g.memberIds.includes(me.id);
}

/**
 * Derive the effective phase of an election by reconciling the stored status
 * with deadline timestamps. The stored status only advances forward; deadlines
 * auto-advance the phase without requiring an explicit admin action.
 *
 * @returns {"nominations"|"voting"|"closed"|"certified"}
 */
export function electionPhase(election) {
  if (election.status === "certified") return "certified";
  if (election.status === "closed")    return "closed";

  const now = Date.now();

  if (election.status === "nominations") {
    if (!election.nominations_deadline) return "nominations";
    if (new Date(election.nominations_deadline).getTime() <= now) return "voting";
    return "nominations";
  }

  // status === "voting"
  if (election.voting_deadline && new Date(election.voting_deadline).getTime() <= now) {
    return "closed";
  }
  return "voting";
}

/**
 * Human-readable countdown for a deadline ISO string.
 * Returns null if no deadline provided.
 */
export function deadlineLabel(isoString) {
  if (!isoString) return null;
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "Closed";
  const h = Math.floor(diff / 3_600_000);
  if (h < 1)  return "Closes soon";
  if (h < 24) return `Closes in ${h}h`;
  return `Closes in ${Math.ceil(diff / 86_400_000)}d`;
}

/**
 * Tally majority (plurality) votes.
 * ballotItems: array of { candidate_id, rank } — for majority, rank is always 1.
 * Returns { [candidateId]: count } for all candidates (0 if no votes).
 */
export function tallyMajority(candidates, ballotItems) {
  const counts = {};
  for (const c of candidates) counts[c.id] = 0;
  for (const item of ballotItems) {
    if (item.rank === 1 && item.candidate_id in counts) {
      counts[item.candidate_id]++;
    }
  }
  return counts;
}

/**
 * One round of IRV: count first-choice votes among non-eliminated candidates.
 * ballotItems: all items for this election, across all ballots.
 *   Each ballot's items have a unique ballot_id and are ordered by rank ascending.
 * eliminated: Set of candidate ids already eliminated.
 * Returns { [candidateId]: count } for active candidates only.
 */
export function runIRVRound(activeCandidateIds, ballotItems, eliminated) {
  // Group ballot items by ballot_id, sorted by rank
  const byBallot = {};
  for (const item of ballotItems) {
    if (!byBallot[item.ballot_id]) byBallot[item.ballot_id] = [];
    byBallot[item.ballot_id].push(item);
  }
  for (const items of Object.values(byBallot)) {
    items.sort((a, b) => a.rank - b.rank);
  }

  const counts = {};
  for (const id of activeCandidateIds) counts[id] = 0;

  for (const items of Object.values(byBallot)) {
    // First non-eliminated choice on this ballot
    const top = items.find(i => !eliminated.has(i.candidate_id) && i.candidate_id in counts);
    if (top) counts[top.candidate_id]++;
  }

  return counts;
}

/**
 * Full IRV (instant runoff) tally.
 * Returns { winner: candidateId|null, rounds: [{counts, eliminated: candidateId|null}] }
 * winner is null if no ballots were cast.
 */
export function tallyRankedChoice(candidates, ballotItems) {
  if (candidates.length === 0 || ballotItems.length === 0) {
    return { winner: null, rounds: [] };
  }

  // Pre-build and sort ballot groups once — reused across every IRV round
  const byBallot = {};
  for (const item of ballotItems) {
    if (!byBallot[item.ballot_id]) byBallot[item.ballot_id] = [];
    byBallot[item.ballot_id].push(item);
  }
  const ballotEntries = Object.values(byBallot);
  for (const items of ballotEntries) items.sort((a, b) => a.rank - b.rank);

  const totalBallots = ballotEntries.length;
  if (totalBallots === 0) return { winner: null, rounds: [] };

  const active = new Set(candidates.map(c => c.id));
  const eliminated = new Set();
  const rounds = [];

  while (active.size > 0) {
    // Count first-choice votes using pre-sorted entries (no per-round rebuild)
    const counts = {};
    for (const id of active) counts[id] = 0;
    for (const items of ballotEntries) {
      const top = items.find(i => !eliminated.has(i.candidate_id) && i.candidate_id in counts);
      if (top) counts[top.candidate_id]++;
    }
    const totalVotes = Object.values(counts).reduce((s, n) => s + n, 0);

    // Find winner (majority)
    for (const [id, count] of Object.entries(counts)) {
      if (count > totalBallots / 2) {
        rounds.push({ counts, eliminated: null });
        return { winner: id, rounds };
      }
    }

    // Only one candidate left — they win by default
    if (active.size === 1) {
      rounds.push({ counts, eliminated: null });
      return { winner: [...active][0], rounds };
    }

    // Eliminate the candidate(s) with the fewest votes
    const minCount = Math.min(...Object.values(counts));
    const toEliminate = Object.entries(counts)
      .filter(([, c]) => c === minCount)
      .map(([id]) => id);

    // If all remaining candidates are tied — no clear winner
    if (toEliminate.length === active.size) {
      rounds.push({ counts, eliminated: null });
      return { winner: null, rounds };
    }

    // Eliminate one at a time (alphabetical by id for determinism in ties)
    toEliminate.sort();
    const loser = toEliminate[0];
    eliminated.add(loser);
    active.delete(loser);
    rounds.push({ counts, eliminated: loser });
  }

  return { winner: null, rounds };
}

/**
 * Derive the winning candidate id for a completed election.
 * Returns null if no votes or a tie.
 */
export function winnerId(election, candidates, ballotItems) {
  if (candidates.length === 0 || ballotItems.length === 0) return null;
  if (election.voting_method === "ranked_choice") {
    return tallyRankedChoice(candidates, ballotItems).winner;
  }
  const counts = tallyMajority(candidates, ballotItems);
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0 || sorted[0][1] === 0) return null;
  // Tie: two or more candidates share the top count
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return sorted[0][0];
}

/** Page size used when walking the hub's paginated ballot-results endpoint. */
export const BALLOT_PAGE_SIZE = 500;

/**
 * Fetch every ballot item for an election, following the hub's pagination.
 *
 * The endpoint pages over ballot ITEMS, and a ranked election has one item per
 * candidate ranked per ballot — 60 voters over 10 candidates is 600 items, well
 * past one page, while ballot_count is only 60. Tallying a single page would
 * silently name the wrong winner, so every page is walked before tabulating.
 *
 * `fetchPage(query)` returns the parsed { ok, body } of one request.
 */
export async function loadAllBallotItems(electionId, fetchPage, pageSize = BALLOT_PAGE_SIZE) {
  const items = [];
  let ballotCount = 0;
  for (let offset = 0; ; offset += pageSize) {
    const query = `session_id=${encodeURIComponent(electionId)}&limit=${pageSize}&offset=${offset}`;
    const { ok, body } = await fetchPage(query);
    if (!ok) throw new Error(body?.error ?? "Unable to load election results");
    const rows = body?.rows ?? [];
    items.push(...rows);
    ballotCount = Number(body?.ballot_count ?? 0);
    if (!body?.has_more || rows.length === 0) break;
  }
  return { items, ballotCount };
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * The office and term label are what an election is looked up by —
 * "who stood for treasurer in 2025" is the office plus the term.
 */
export function searchableFields(item) {
  return [item.title, item.office, item.term_label];
}

/**
 * Project a stored deadline onto the bare `yyyy-mm-dd` the calendar's
 * `create_event` takes, or "" when there is nothing usable to project.
 *
 * Deadlines are written from a `datetime-local` input, so they arrive as
 * `YYYY-MM-DDTHH:MM` — household-LOCAL, never UTC (see 004_deadlines_plaintext).
 * Re-parsing one through `new Date()` to reformat it would drag it through the
 * device's zone and can land the entry a day either side of the deadline, so the
 * date part is taken as text and never re-interpreted. Already-date-only values
 * pass straight through: older rows and any hand-written deadline are stored that
 * way, and both shapes have to reach the calendar as the same day.
 *
 * "" rather than null because the caller treats it as "there is no calendar
 * entry to make" — and an empty `event_date` is exactly what fails an automation
 * run with `missing required param`, which is what the guard exists to prevent.
 */
export function deadlineCalendarDate(deadline) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(String(deadline ?? "").trim());
  return m ? m[1] : "";
}

/** How a voting method reads in prose the household did not choose from a radio. */
function votingMethodLabel(method) {
  return method === "ranked_choice" ? "ranked-choice (IRV)" : "majority";
}

/**
 * Title of the calendar entry an opened election puts on the org calendar.
 * Names the office, because a calendar full of "Voting closes" says nothing
 * about which seat is being filled.
 */
export function votingReviewTitle(election) {
  const office = String(election?.office ?? "").trim();
  return office ? `${office} — voting closes` : "Officer election — voting closes";
}

/**
 * Second line of that entry: which method decides it, so a member reading the
 * calendar knows whether they are picking one name or ranking a list before
 * they open the app. Deliberately carries no candidate names — the entry rides
 * the household ICS feed out to Google/Apple, and who stood for office is not
 * something to hand an external calendar service.
 */
export function votingReviewSummary(election) {
  return `Ballots close for ${String(election?.office ?? "this office").trim() || "this office"} · ${votingMethodLabel(election?.voting_method)} vote`;
}
