export { memberColor, initial, esc, isAdult, formatRelativeDate } from "./shared.js";

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
