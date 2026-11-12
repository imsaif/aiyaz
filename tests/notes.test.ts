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

describe("visitor name and role in notes", () => {
  const start = emptyNotes(null);
  it("start empty", () => {
    expect(start.visitor_name).toBeNull();
    expect(start.visitor_role).toBeNull();
  });
  it("store trimmed", () => {
    const n = applyNotesUpdate(start, { visitor_name: "  Sam Lee ", visitor_role: " CTO " });
    expect(n.visitor_name).toBe("Sam Lee");
    expect(n.visitor_role).toBe("CTO");
  });
  it("are capped at 80 characters and newlines become spaces", () => {
    const n = applyNotesUpdate(start, { visitor_name: "Sam\nLee\r\nJr", visitor_role: "x".repeat(200) });
    expect(n.visitor_name).toBe("Sam Lee Jr");
    expect(n.visitor_role).toHaveLength(80);
  });
  it("blank values are ignored and never replace a stored one", () => {
    expect(applyNotesUpdate(start, { visitor_name: "   ", visitor_role: "" }).visitor_name).toBeNull();
    const stored = applyNotesUpdate(start, { visitor_name: "Sam", visitor_role: "CTO" });
    const next = applyNotesUpdate(stored, { visitor_name: " ", visitor_role: "" });
    expect(next.visitor_name).toBe("Sam");
    expect(next.visitor_role).toBe("CTO");
  });
});
