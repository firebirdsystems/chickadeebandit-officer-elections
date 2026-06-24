import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const VALID_STORAGE   = ["kv", "db", "none"];
const VALID_AUDIENCES = ["everyone", "adults", "children"];

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static",        () => expect(manifest.runtime).toBe("static"));

  it("storage is declared and valid", () => {
    expect(manifest.storage, "storage field is required").toBeTruthy();
    expect(VALID_STORAGE).toContain(manifest.storage);
  });

  it("version follows semver", () => expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/));

  it("permissions.default_audience is valid", () => {
    expect(VALID_AUDIENCES).toContain(manifest.permissions.default_audience);
  });

  it("permissions.requires_approval is boolean", () => {
    expect(typeof manifest.permissions.requires_approval).toBe("boolean");
  });

  it("data_access has reads and writes arrays", () => {
    expect(Array.isArray(manifest.data_access.reads)).toBe(true);
    expect(Array.isArray(manifest.data_access.writes)).toBe(true);
  });
});

describe("ballot security", () => {
  it("blocks direct ballot reads and writes", () => {
    expect(manifest.row_policies.oe_ballots).toEqual({ kind: "endpoint_only", read: "none" });
    expect(manifest.row_policies.oe_ballot_items).toEqual({ kind: "endpoint_only", read: "none" });
    expect(manifest.row_policies.oe_ballot_receipts.endpoint_writes_only).toBe(true);
  });

  it("declares election, deadline, method, candidate, and result validation", () => {
    expect(manifest.anonymous_ballot).toMatchObject({
      session_table: "oe_elections",
      session_id_column: "id",
      session_status_column: "status",
      session_open_values: ["voting"],
      result_visible_values: ["closed", "certified"],
      session_deadline_column: "voting_deadline",
      session_voting_method_column: "voting_method",
      majority_method_values: ["majority"],
      ranked_method_values: ["ranked_choice"],
      candidate_table: "oe_candidates",
      candidate_session_column: "election_id",
      candidate_id_column: "id",
    });
  });
});
