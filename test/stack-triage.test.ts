import { describe, expect, test } from "bun:test";
import { createStackMap, setTipBranch } from "../src/stack-map";
import { stackTriage } from "../src/stack";
import type { StackEntry, StackMap, StackStatus } from "../src/types";

function entry(position: number, status: StackStatus, extra: Partial<StackEntry> = {}): StackEntry {
  return {
    position,
    issueId: `ENG-${100 + position}`,
    issueTitle: `Issue ${position}`,
    branchName: `feat/eng-${100 + position}`,
    changeId: `c${position}`,
    baseBranch: position === 0 ? "main" : `feat/eng-${100 + position - 1}`,
    headSha: "sha",
    status,
    ...extra,
  };
}

function mapWith(entries: readonly StackEntry[]): StackMap {
  return createStackMap({
    feature: "checkout",
    repoSlug: "app-abc12345",
    baseBranch: "main",
    source: { issueIds: entries.map((e) => e.issueId) },
    entries,
  });
}

describe("stackTriage", () => {
  test("building: unbuilt entries remain", () => {
    const report = stackTriage(mapWith([entry(0, "implemented"), entry(1, "implementing"), entry(2, "pending")]));
    expect(report.phase).toBe("building");
    expect(report.action).toBe("build");
    expect(report.inFlight).toBe("ENG-101");
    expect(report.counts.total).toBe(3);
  });

  test("built-unpublished: all built, none published", () => {
    const report = stackTriage(mapWith([entry(0, "implemented"), entry(1, "implemented")]));
    expect(report.phase).toBe("built-unpublished");
    expect(report.action).toBe("push");
  });

  test("has-stale: a pushed entry was re-flowed", () => {
    const map = mapWith([
      entry(0, "pr-open", { prNumber: 51, headSha: "NEW", pushedSha: "OLD" }),
      entry(1, "implemented"),
    ]);
    const report = stackTriage(map);
    expect(report.phase).toBe("has-stale");
    expect(report.action).toBe("push");
    expect(report.staleBranches).toEqual(["feat/eng-100"]);
  });

  test("publishing: all open, nothing to do but wait", () => {
    const map = mapWith([
      entry(0, "pr-open", { prNumber: 51, headSha: "x", pushedSha: "x" }),
      entry(1, "pr-open", { prNumber: 52, headSha: "y", pushedSha: "y" }),
    ]);
    const report = stackTriage(map);
    expect(report.phase).toBe("publishing");
    expect(report.action).toBe("wait");
  });

  test("complete: everything merged", () => {
    const report = stackTriage(mapWith([entry(0, "merged"), entry(1, "merged")]));
    expect(report.phase).toBe("complete");
    expect(report.action).toBe("done");
  });

  test("carries the tip and a human summary", () => {
    const report = stackTriage(setTipBranch(mapWith([entry(0, "implemented")]), "feat/eng-100"));
    expect(report.tipBranch).toBe("feat/eng-100");
    expect(report.summary).toContain("unbuilt");
  });
});
