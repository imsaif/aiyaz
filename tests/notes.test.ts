import { describe, expect, it } from "vitest";
import { applyNotesUpdate, emptyNotes } from "../src/notes.js";

describe("visitor email in notes", () => {
  const start = emptyNotes(null);
  it("starts empty", () => {
    expect(start.visitor_email).toBeNull();
  });
  it("stores a valid email trimmed and lowercased", () => {
    expect(applyNotesUpdate(start, { visitor_email: "  Sam@Acme.TEST " }).visitor_email).toBe("sam@acme.test");
  });
  it("does not store an invalid email", () => {
    for (const bad of ["nope", "a@b", "a b@acme.test", "", "   "]) {
      expect(applyNotesUpdate(start, { visitor_email: bad }).visitor_email).toBeNull();
    }
  });
  it("an invalid email leaves a stored one unchanged", () => {
    const stored = applyNotesUpdate(start, { visitor_email: "sam@acme.test" });
    expect(applyNotesUpdate(stored, { visitor_email: "nope" }).visitor_email).toBe("sam@acme.test");
  });
});
