/**
 * Property-based tests for the tallies.
 *
 * logic.test.mjs walks the elections someone thought of. These hold for every
 * electorate a generator can produce — any number of candidates, ballots that
 * rank all of them or only some, ties at every stage:
 *
 *  - NO INVENTED VOTES. A round never counts more votes than there are
 *    ballots, and a ballot only ever leaves the count (exhausted), never joins.
 *  - TRANSFERS ONLY ADD. A candidate still standing never loses votes from one
 *    round to the next.
 *  - THE OBVIOUS WINNER WINS. Whoever is first choice on more than half the
 *    ballots wins outright, in round one.
 *  - A RESULT IS A FACT ABOUT THE BALLOTS, not about the order the rows came
 *    back from the database in.
 *
 * The seed is random by default; fast-check prints the failing seed and a
 * shrunk counterexample. Replay with
 *   CB_FC_SEED=<seed> CB_FC_RUNS=1 npx vitest run logic.property
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runIRVRound, tallyMajority, tallyRankedChoice, winnerId } from '../src/logic.js';

const FC = {
  numRuns: Number(process.env.CB_FC_RUNS ?? 300),
  ...(process.env.CB_FC_SEED ? { seed: Number(process.env.CB_FC_SEED) } : {}),
};

// ── Generators ──────────────────────────────────────────────────────────────

const candidatesArb = fc.integer({ min: 1, max: 7 }).map(n => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}` })));

/** One ranked ballot: a non-empty ordering of some of the candidates. */
const rankingArb = ids => fc.shuffledSubarray(ids, { minLength: 1 });

/** An election: candidates, and ballots that each rank one or more of them
 *  with ranks 1..k. `rankings` is kept so a property can reason about the
 *  ballots without re-deriving them from the flat rows the tally consumes. */
const electionArb = candidatesArb.chain(candidates => {
  const ids = candidates.map(c => c.id);
  return fc.array(rankingArb(ids), { minLength: 1, maxLength: 40 }).map(rankings => ({
    candidates,
    rankings,
    items: rankings.flatMap((ranking, b) =>
      ranking.map((candidate_id, i) => ({ ballot_id: `b${b}`, candidate_id, rank: i + 1 }))),
  }));
});

/** A plurality election: every ballot names exactly one candidate. */
const pluralityArb = candidatesArb.chain(candidates =>
  fc.array(fc.constantFrom(...candidates.map(c => c.id)), { minLength: 1, maxLength: 60 }).map(votes => ({
    candidates,
    votes,
    items: votes.map((candidate_id, b) => ({ ballot_id: `b${b}`, candidate_id, rank: 1 })),
  })),
);

const sum = counts => Object.values(counts).reduce((s, n) => s + n, 0);

function shuffled(rows, rnd) {
  return rows.map(r => [rnd.next().value, r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

// ── Plurality ───────────────────────────────────────────────────────────────

describe('tallyMajority', () => {
  it('counts every ballot exactly once and reports every candidate', () => {
    fc.assert(fc.property(pluralityArb, ({ candidates, votes, items }) => {
      const counts = tallyMajority(candidates, items);
      expect(Object.keys(counts).sort()).toEqual(candidates.map(c => c.id).sort());
      expect(sum(counts)).toBe(votes.length);
      for (const c of candidates) expect(counts[c.id]).toBe(votes.filter(v => v === c.id).length);
    }), FC);
  });

  it('ignores a vote for someone who is not a candidate, and any rank but first', () => {
    fc.assert(fc.property(pluralityArb, ({ candidates, items }) => {
      const noise = [
        { ballot_id: 'bx', candidate_id: 'withdrawn', rank: 1 },
        { ballot_id: 'by', candidate_id: candidates[0].id, rank: 2 },
      ];
      expect(tallyMajority(candidates, [...items, ...noise])).toEqual(tallyMajority(candidates, items));
    }), FC);
  });
});

describe('winnerId (plurality)', () => {
  const election = { voting_method: 'majority' };

  it('names the one candidate with strictly the most votes, or nobody on a tie', () => {
    fc.assert(fc.property(pluralityArb, ({ candidates, votes, items }) => {
      const tally = candidates.map(c => ({ id: c.id, n: votes.filter(v => v === c.id).length }));
      const top = Math.max(...tally.map(t => t.n));
      const leaders = tally.filter(t => t.n === top);
      expect(winnerId(election, candidates, items)).toBe(leaders.length === 1 ? leaders[0].id : null);
    }), FC);
  });

  it('does not depend on the order ballots or candidates arrive in', () => {
    fc.assert(fc.property(pluralityArb, fc.infiniteStream(fc.nat()), ({ candidates, items }, rnd) => {
      expect(winnerId(election, shuffled(candidates, rnd), shuffled(items, rnd)))
        .toBe(winnerId(election, candidates, items));
    }), FC);
  });
});

// ── Instant runoff ──────────────────────────────────────────────────────────

describe('tallyRankedChoice', () => {
  it('names a real candidate or nobody', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const { winner } = tallyRankedChoice(candidates, items);
      if (winner !== null) expect(candidates.map(c => c.id)).toContain(winner);
    }), FC);
  });

  it('never counts more votes in a round than there are ballots', () => {
    fc.assert(fc.property(electionArb, ({ candidates, rankings, items }) => {
      for (const round of tallyRankedChoice(candidates, items).rounds) {
        expect(sum(round.counts)).toBeLessThanOrEqual(rankings.length);
        for (const n of Object.values(round.counts)) {
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
        }
      }
    }), FC);
  });

  it('counts every ballot in round one — each ranks at least one candidate', () => {
    fc.assert(fc.property(electionArb, ({ candidates, rankings, items }) => {
      const { rounds } = tallyRankedChoice(candidates, items);
      expect(sum(rounds[0].counts)).toBe(rankings.length);
      for (const c of candidates) {
        expect(rounds[0].counts[c.id]).toBe(rankings.filter(r => r[0] === c.id).length);
      }
    }), FC);
  });

  it('only ever loses ballots to exhaustion: the round total never grows', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const totals = tallyRankedChoice(candidates, items).rounds.map(r => sum(r.counts));
      for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    }), FC);
  });

  it('never takes a vote away from a candidate who is still standing', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const { rounds } = tallyRankedChoice(candidates, items);
      for (let i = 1; i < rounds.length; i++) {
        for (const [id, n] of Object.entries(rounds[i].counts)) {
          expect(n).toBeGreaterThanOrEqual(rounds[i - 1].counts[id]);
        }
      }
    }), FC);
  });

  it('eliminates one candidate per round — a last-place one — and never counts them again', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const { rounds } = tallyRankedChoice(candidates, items);
      const gone = new Set();
      rounds.forEach((round, i) => {
        for (const id of gone) expect(round.counts).not.toHaveProperty(id);
        expect(Object.keys(round.counts).length).toBe(candidates.length - gone.size);
        if (round.eliminated === null) {
          // Only the final round eliminates nobody.
          expect(i).toBe(rounds.length - 1);
          return;
        }
        expect(gone.has(round.eliminated)).toBe(false);
        expect(round.counts[round.eliminated]).toBe(Math.min(...Object.values(round.counts)));
        gone.add(round.eliminated);
      });
      expect(rounds.length).toBeLessThanOrEqual(candidates.length);
    }), FC);
  });

  it('a candidate who is first choice on more than half the ballots wins in round one', () => {
    fc.assert(fc.property(electionArb, ({ candidates, rankings, items }) => {
      const outright = candidates.find(c => rankings.filter(r => r[0] === c.id).length > rankings.length / 2);
      if (!outright) return;
      const result = tallyRankedChoice(candidates, items);
      expect(result.winner).toBe(outright.id);
      expect(result.rounds).toHaveLength(1);
    }), FC);
  });

  it('a winner holds a majority of all ballots, or is the last candidate standing', () => {
    fc.assert(fc.property(electionArb, ({ candidates, rankings, items }) => {
      const { winner, rounds } = tallyRankedChoice(candidates, items);
      if (winner === null) return;
      const final = rounds[rounds.length - 1].counts;
      const byMajority = final[winner] > rankings.length / 2;
      const lastStanding = Object.keys(final).length === 1;
      expect(byMajority || lastStanding).toBe(true);
      // Nobody else in the final round is ahead of the winner.
      for (const n of Object.values(final)) expect(final[winner]).toBeGreaterThanOrEqual(n);
    }), FC);
  });

  it('declares nobody only when the candidates left are dead level', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const { winner, rounds } = tallyRankedChoice(candidates, items);
      if (winner !== null) return;
      const final = Object.values(rounds[rounds.length - 1].counts);
      expect(final.length).toBeGreaterThan(1);
      expect(new Set(final).size).toBe(1);
    }), FC);
  });

  it('does not depend on the order ballot rows or candidates arrive in', () => {
    fc.assert(fc.property(electionArb, fc.infiniteStream(fc.nat()), ({ candidates, items }, rnd) => {
      const base = tallyRankedChoice(candidates, items);
      const again = tallyRankedChoice(shuffled(candidates, rnd), shuffled(items, rnd));
      expect(again.winner).toBe(base.winner);
      expect(again.rounds).toEqual(base.rounds);
    }), FC);
  });

  it('ignores rankings for someone who is not a candidate', () => {
    fc.assert(fc.property(electionArb, ({ candidates, rankings, items }) => {
      // A withdrawn candidate ranked LAST on every ballot changes nothing.
      const withGhost = [
        ...items,
        ...rankings.map((ranking, b) => ({ ballot_id: `b${b}`, candidate_id: 'withdrawn', rank: ranking.length + 1 })),
      ];
      expect(tallyRankedChoice(candidates, withGhost)).toEqual(tallyRankedChoice(candidates, items));
    }), FC);
  });

  it('agrees with plurality whenever every ballot names one candidate and someone has a majority', () => {
    fc.assert(fc.property(pluralityArb, ({ candidates, votes, items }) => {
      const outright = candidates.find(c => votes.filter(v => v === c.id).length > votes.length / 2);
      if (!outright) return;
      expect(tallyRankedChoice(candidates, items).winner).toBe(outright.id);
      expect(winnerId({ voting_method: 'majority' }, candidates, items)).toBe(outright.id);
      expect(winnerId({ voting_method: 'ranked_choice' }, candidates, items)).toBe(outright.id);
    }), FC);
  });

  it('has no winner and no rounds when there is nothing to count', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      expect(tallyRankedChoice([], items)).toEqual({ winner: null, rounds: [] });
      expect(tallyRankedChoice(candidates, [])).toEqual({ winner: null, rounds: [] });
    }), FC);
  });
});

describe('runIRVRound', () => {
  it('with nobody eliminated, is round one of the full tally', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const ids = candidates.map(c => c.id);
      expect(runIRVRound(ids, items, new Set())).toEqual(tallyRankedChoice(candidates, items).rounds[0].counts);
    }), FC);
  });

  it('replays every round of the full tally from its eliminations', () => {
    fc.assert(fc.property(electionArb, ({ candidates, items }) => {
      const eliminated = new Set();
      for (const round of tallyRankedChoice(candidates, items).rounds) {
        const active = candidates.map(c => c.id).filter(id => !eliminated.has(id));
        expect(runIRVRound(active, items, eliminated)).toEqual(round.counts);
        if (round.eliminated) eliminated.add(round.eliminated);
      }
    }), FC);
  });
});
