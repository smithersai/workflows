import { describe, expect, test } from "bun:test";
import { howToGuide } from "../src/howto";

describe("howToGuide", () => {
  const guide = howToGuide();

  test("documents the triage-driven loop and the action mapping", () => {
    expect(guide).toContain("xiv stack triage");
    expect(guide).toContain("action=plan");
    expect(guide).toContain("action=build");
    expect(guide).toContain("action=push");
    expect(guide).toContain("action=done");
  });

  test("lists every stack lifecycle command", () => {
    for (const command of ["xiv stack init", "xiv stack plan", "xiv stack build", "xiv stack push", "xiv stack amend"]) {
      expect(guide).toContain(command);
    }
  });

  test("states the hard rules and where commands must run", () => {
    expect(guide).toContain("target git repo");
    expect(guide).toContain("Never merge");
  });

  test("documents multi-repo orchestration", () => {
    expect(guide).toContain("MULTI-REPO");
    expect(guide).toContain("--all-repos");
  });
});
