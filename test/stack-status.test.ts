import { describe, expect, test } from "bun:test";
import { createStackMap, setTipBranch } from "../src/stack-map";
import { stackInitAction, stackStatusReport } from "../src/stack";
import type { JjPreflight, StackEntry, StackMap } from "../src/types";

function entry(position: number, patch: Partial<StackEntry> = {}): StackEntry {
  return {
    position,
    issueId: `ENG-${100 + position}`,
    issueTitle: `Issue ${position}`,
    branchName: `feat/eng-${100 + position}`,
    changeId: `chg${position}`,
    baseBranch: position === 0 ? "main" : `feat/eng-${100 + position - 1}`,
    headSha: "",
    status: "pending",
    ...patch,
  };
}

function sampleMap(): StackMap {
  return createStackMap({
    feature: "checkout",
    repoSlug: "app-abc12345",
    baseBranch: "main",
    source: { issueIds: ["ENG-100", "ENG-101"] },
    entries: [
      entry(0, { status: "pr-open", prNumber: 1234 }),
      entry(1, { status: "implemented" }),
    ],
  });
}

describe("stackStatusReport", () => {
  test("includes the feature header, every entry, and PR numbers", () => {
    const report = stackStatusReport(sampleMap());
    expect(report).toContain("Stack: checkout");
    expect(report).toContain("engine jj");
    expect(report).toContain("ENG-100");
    expect(report).toContain("ENG-101");
    expect(report).toContain("#1234");
    expect(report).toContain("pr-open");
  });

  test("flags an unbuilt tip and a built tip", () => {
    expect(stackStatusReport(sampleMap())).toContain("not built yet");
    const built = setTipBranch(sampleMap(), "feat/eng-101");
    expect(stackStatusReport(built)).toContain("git checkout feat/eng-101");
  });
});

describe("stackInitAction", () => {
  const preflight = (over: Partial<JjPreflight>): JjPreflight => ({
    available: true,
    isRepo: false,
    version: "0.28.0",
    ...over,
  });

  test("install-jj when jj is missing", () => {
    expect(stackInitAction(preflight({ available: false, version: null }))).toBe("install-jj");
  });

  test("already-colocated when the repo is a jj repo", () => {
    expect(stackInitAction(preflight({ isRepo: true }))).toBe("already-colocated");
  });

  test("colocate when jj is present but the repo is plain git", () => {
    expect(stackInitAction(preflight({ isRepo: false }))).toBe("colocate");
  });
});
