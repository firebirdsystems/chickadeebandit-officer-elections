import { describe, it, expect } from "vitest";
import { outcomeUnknown, storedDiffers, SAVED_AS_FIRST } from "../src/logic.js";

const err = (props, message = "hub text") => Object.assign(new Error(message), props);

describe("outcomeUnknown", () => {
  it("is unknown with no status, a 400, or a 5xx other than 507", () => {
    for (const e of [new TypeError("Failed to fetch"), err({ status: 0 }), err({ status: 400 }), err({ status: 500 }), err({ status: 503 })]) {
      expect(outcomeUnknown(e)).toBe(true);
    }
  });
  it("is known for a refusal", () => {
    for (const e of [err({ status: 403 }), err({ status: 404 }), err({ status: 409 }), err({ status: 413 }), err({ status: 429 }), err({ status: 507 })]) {
      expect(outcomeUnknown(e)).toBe(false);
    }
  });
  it("reads back on a duplicate: a retry that landed collides on its own pinned id", () => {
    for (const e of [err({ status: 400, code: "UNIQUE_CONSTRAINT" }), err({ status: 400 }, "UNIQUE constraint failed: x.id")]) {
      expect(outcomeUnknown(e)).toBe(true);
    }
  });
});

describe("storedDiffers", () => {
  const fields = { title: "Leak", count: 2, date: "", note: "" };
  it("treats a stored row matching the form as the same, as text", () => {
    expect(storedDiffers({ id: "x", title: "Leak", count: "2", date: null, note: "" }, fields)).toBe(false);
  });
  it("sees an edit made since the first try", () => {
    expect(storedDiffers({ title: "Leak", count: 1, date: "", note: "" }, fields)).toBe(true);
  });
  it("ignores stored columns the form does not hold", () => {
    expect(storedDiffers({ title: "Leak", count: 2, date: "", note: "", created_at: "now" }, fields)).toBe(false);
  });
});

describe("SAVED_AS_FIRST", () => {
  it("is the guide's line", () => {
    expect(SAVED_AS_FIRST).toBe("Saved as first entered — check it and update what changed.");
  });
});
