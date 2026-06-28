import { describe, it, expect } from "vitest";
import {
  electionPhase,
  deadlineLabel,
  tallyMajority,
  runIRVRound,
  tallyRankedChoice,
  winnerId,
  canManageElections,
} from "../src/logic.js";
import { testPrivilegedGateContract } from "./helpers/privileged-gate.mjs";

// ── canManageElections ────────────────────────────────────────────────────────
// Fronts the oe_elections / oe_candidates write_privileged_only policies, so it
// must satisfy the shared privileged-gate contract (mirrors the hub: no adult
// fallback when no officials group is configured).

testPrivilegedGateContract("canManageElections", canManageElections, {
  member:   { id: "a1", role: "adult" },
  outsider: { id: "a3", role: "adult" },
  groups:   [{ id: "g1", memberIds: ["a1", "a2"] }],
  groupId:  "g1",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function future(hours = 24) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}
function past(hours = 1) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function mkElection(overrides = {}) {
  return {
    status: "nominations",
    voting_method: "majority",
    nominations_deadline: future(48),
    voting_deadline: future(96),
    has_nominations: 1,
    ...overrides,
  };
}

const cA = { id: "c-a" };
const cB = { id: "c-b" };
const cC = { id: "c-c" };

// Build ballot items for a majority election (rank always 1)
function majorityItems(choices) {
  // choices: [{ ballotId, candidateId }]
  return choices.map(({ ballotId, candidateId }) => ({
    ballot_id: ballotId, candidate_id: candidateId, rank: 1,
  }));
}

// Build ballot items for a ranked-choice election
// choices: [{ ballotId, ranks: [candidateId, ...] }]  (first entry = rank 1)
function rcItems(choices) {
  const items = [];
  for (const { ballotId, ranks } of choices) {
    ranks.forEach((candidateId, i) => {
      items.push({ ballot_id: ballotId, candidate_id: candidateId, rank: i + 1 });
    });
  }
  return items;
}

// ─── electionPhase ────────────────────────────────────────────────────────────

describe("electionPhase", () => {
  it("returns 'certified' regardless of deadlines", () => {
    expect(electionPhase(mkElection({ status: "certified" }))).toBe("certified");
  });

  it("returns 'closed' when status is closed", () => {
    expect(electionPhase(mkElection({ status: "closed" }))).toBe("closed");
  });

  it("returns 'nominations' when deadline is in the future", () => {
    expect(electionPhase(mkElection({ status: "nominations", nominations_deadline: future(2) }))).toBe("nominations");
  });

  it("advances nominations → voting when nominations deadline has passed", () => {
    expect(electionPhase(mkElection({ status: "nominations", nominations_deadline: past(1) }))).toBe("voting");
  });

  it("returns 'voting' when status is voting and deadline is future", () => {
    expect(electionPhase(mkElection({ status: "voting", voting_deadline: future(2) }))).toBe("voting");
  });

  it("advances voting → closed when voting deadline has passed", () => {
    expect(electionPhase(mkElection({ status: "voting", voting_deadline: past(1) }))).toBe("closed");
  });

  it("returns 'nominations' when no nominations_deadline is set", () => {
    expect(electionPhase(mkElection({ status: "nominations", nominations_deadline: null }))).toBe("nominations");
  });
});

// ─── deadlineLabel ────────────────────────────────────────────────────────────

describe("deadlineLabel", () => {
  it("returns null for no deadline", () => {
    expect(deadlineLabel(null)).toBeNull();
  });

  it("returns 'Closed' for past deadline", () => {
    expect(deadlineLabel(past(1))).toBe("Closed");
  });

  it("returns 'Closes soon' for deadline within the hour", () => {
    const label = deadlineLabel(future(0.4));
    expect(label).toBe("Closes soon");
  });

  it("returns hours countdown for < 24h", () => {
    const label = deadlineLabel(future(3));
    expect(label).toBe("Closes in 3h");
  });

  it("returns days countdown for >= 24h", () => {
    const label = deadlineLabel(future(48));
    expect(label).toBe("Closes in 2d");
  });
});

// ─── tallyMajority ────────────────────────────────────────────────────────────

describe("tallyMajority", () => {
  it("counts correctly", () => {
    const items = majorityItems([
      { ballotId: "b1", candidateId: "c-a" },
      { ballotId: "b2", candidateId: "c-a" },
      { ballotId: "b3", candidateId: "c-b" },
    ]);
    const result = tallyMajority([cA, cB], items);
    expect(result["c-a"]).toBe(2);
    expect(result["c-b"]).toBe(1);
  });

  it("returns zeroes for all candidates when no votes", () => {
    const result = tallyMajority([cA, cB], []);
    expect(result["c-a"]).toBe(0);
    expect(result["c-b"]).toBe(0);
  });

  it("handles a tie", () => {
    const items = majorityItems([
      { ballotId: "b1", candidateId: "c-a" },
      { ballotId: "b2", candidateId: "c-b" },
    ]);
    const result = tallyMajority([cA, cB], items);
    expect(result["c-a"]).toBe(1);
    expect(result["c-b"]).toBe(1);
  });

  it("ignores unknown candidate ids in ballot items", () => {
    const items = [{ ballot_id: "b1", candidate_id: "c-unknown", rank: 1 }];
    const result = tallyMajority([cA], items);
    expect(result["c-a"]).toBe(0);
  });
});

// ─── tallyRankedChoice ────────────────────────────────────────────────────────

describe("tallyRankedChoice", () => {
  it("returns null winner for empty ballots", () => {
    const { winner } = tallyRankedChoice([cA, cB], []);
    expect(winner).toBeNull();
  });

  it("returns null winner for empty candidates", () => {
    const { winner } = tallyRankedChoice([], []);
    expect(winner).toBeNull();
  });

  it("elects unanimous winner immediately", () => {
    const items = rcItems([
      { ballotId: "b1", ranks: ["c-a", "c-b"] },
      { ballotId: "b2", ranks: ["c-a", "c-b"] },
      { ballotId: "b3", ranks: ["c-a", "c-b"] },
    ]);
    const { winner, rounds } = tallyRankedChoice([cA, cB], items);
    expect(winner).toBe("c-a");
    expect(rounds).toHaveLength(1);
  });

  it("elects winner after eliminating last-place candidate", () => {
    // Round 1: A=2, B=1, C=2 → B eliminated (fewest)
    // Round 2: B's vote goes to C → A=2, C=3 → C wins
    const items = rcItems([
      { ballotId: "b1", ranks: ["c-a", "c-c"] },
      { ballotId: "b2", ranks: ["c-a", "c-c"] },
      { ballotId: "b3", ranks: ["c-b", "c-c"] },
      { ballotId: "b4", ranks: ["c-c", "c-a"] },
      { ballotId: "b5", ranks: ["c-c", "c-a"] },
    ]);
    const { winner, rounds } = tallyRankedChoice([cA, cB, cC], items);
    expect(winner).toBe("c-c");
    expect(rounds.length).toBeGreaterThanOrEqual(2);
    expect(rounds[0].eliminated).toBe("c-b");
  });

  it("returns null winner when all remaining candidates are tied", () => {
    // Two candidates, exactly tied
    const items = rcItems([
      { ballotId: "b1", ranks: ["c-a", "c-b"] },
      { ballotId: "b2", ranks: ["c-b", "c-a"] },
    ]);
    const { winner } = tallyRankedChoice([cA, cB], items);
    expect(winner).toBeNull();
  });

  it("handles single candidate", () => {
    const items = rcItems([
      { ballotId: "b1", ranks: ["c-a"] },
    ]);
    const { winner } = tallyRankedChoice([cA], items);
    expect(winner).toBe("c-a");
  });
});

// ─── winnerId ─────────────────────────────────────────────────────────────────

describe("winnerId", () => {
  it("delegates to tallyMajority for majority elections", () => {
    const election = mkElection({ voting_method: "majority" });
    const items = majorityItems([
      { ballotId: "b1", candidateId: "c-a" },
      { ballotId: "b2", candidateId: "c-a" },
      { ballotId: "b3", candidateId: "c-b" },
    ]);
    expect(winnerId(election, [cA, cB], items)).toBe("c-a");
  });

  it("delegates to tallyRankedChoice for ranked_choice elections", () => {
    const election = mkElection({ voting_method: "ranked_choice" });
    const items = rcItems([
      { ballotId: "b1", ranks: ["c-a", "c-b"] },
      { ballotId: "b2", ranks: ["c-a", "c-b"] },
      { ballotId: "b3", ranks: ["c-a", "c-b"] },
    ]);
    expect(winnerId(election, [cA, cB], items)).toBe("c-a");
  });

  it("returns null for tie in majority", () => {
    const election = mkElection({ voting_method: "majority" });
    const items = majorityItems([
      { ballotId: "b1", candidateId: "c-a" },
      { ballotId: "b2", candidateId: "c-b" },
    ]);
    expect(winnerId(election, [cA, cB], items)).toBeNull();
  });

  it("returns null when no votes cast", () => {
    const election = mkElection({ voting_method: "majority" });
    expect(winnerId(election, [cA, cB], [])).toBeNull();
  });

  it("returns null when no candidates", () => {
    const election = mkElection({ voting_method: "majority" });
    expect(winnerId(election, [], [])).toBeNull();
  });
});
