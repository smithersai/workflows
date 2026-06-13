import { describe, expect, test } from "bun:test";
import { createStackMap, setTip } from "../src/stack-map";
import { stackTriage } from "../src/stack";
import type { RepoConfig, StackEntry, StackMap, StackStatus } from "../src/types";

function entry(repo: string, position: number, status: StackStatus, extra: Partial<StackEntry> = {}): StackEntry {
  return {
    position,
    issueId: `ENG-${100 + position}`,
    issueTitle: `Issue ${position}`,
    repo,
    branchName: `feat/eng-${100 + position}`,
    changeId: `c${position}`,
    baseBranch: "main",
    headSha: "sha",
    status,
    ...extra,
  };
}

function makeMap(repos: Record<string, RepoConfig>, entries: readonly StackEntry[]): StackMap {
  return createStackMap({
    feature: "checkout",
    repoSlug: "app-abc12345",
    repos,
    source: { issueIds: entries.map((e) => e.issueId) },
    entries,
  });
}

const ONE_REPO: Record<string, RepoConfig> = { app: { path: "/code/app", baseBranch: "main" } };

function single(statuses: readonly StackStatus[]): StackMap {
  return makeMap(ONE_REPO, statuses.map((status, i) => entry("app", i, status)));
}

describe("stackTriage (single repo)", () => {
  test("building: unbuilt entries remain", () => {
    const report = stackTriage(single(["implemented", "implementing", "pending"]));
    expect(report.action).toBe("build");
    expect(report.repos[0]?.phase).toBe("building");
    expect(report.repos[0]?.inFlight).toBe("ENG-101");
    expect(report.counts.total).toBe(3);
  });

  test("built-unpublished: all built, none published", () => {
    const report = stackTriage(single(["implemented", "implemented"]));
    expect(report.action).toBe("push");
    expect(report.repos[0]?.phase).toBe("built-unpublished");
  });

  test("has-stale: a pushed entry was re-flowed", () => {
    const map = makeMap(ONE_REPO, [
      entry("app", 0, "pr-open", { prNumber: 51, headSha: "NEW", pushedSha: "OLD" }),
      entry("app", 1, "implemented"),
    ]);
    const report = stackTriage(map);
    expect(report.action).toBe("push");
    expect(report.repos[0]?.phase).toBe("has-stale");
    expect(report.repos[0]?.staleBranches).toEqual(["feat/eng-100"]);
  });

  test("complete: everything merged", () => {
    const report = stackTriage(single(["merged", "merged"]));
    expect(report.action).toBe("done");
    expect(report.repos[0]?.phase).toBe("complete");
  });

  test("carries the per-repo tip and a human summary", () => {
    const report = stackTriage(setTip(single(["implemented"]), "app", "feat/eng-100"));
    expect(report.repos[0]?.tip).toBe("feat/eng-100");
    expect(report.summary).toContain("unbuilt");
  });
});

describe("stackTriage (multi repo)", () => {
  test("overall action is the most-urgent across repos, with a per-repo breakdown", () => {
    const map = makeMap(
      { api: { path: "/code/api", baseBranch: "main" }, web: { path: "/code/web", baseBranch: "main" } },
      [
        entry("api", 0, "merged"),
        entry("api", 1, "merged"),
        entry("web", 2, "implemented"),
        entry("web", 3, "pending"),
      ],
    );
    const report = stackTriage(map);
    expect(report.action).toBe("build"); // web still has an unbuilt entry
    expect(report.repos).toHaveLength(2);
    const api = report.repos.find((r) => r.repo === "api");
    const web = report.repos.find((r) => r.repo === "web");
    expect(api?.phase).toBe("complete");
    expect(web?.phase).toBe("building");
  });
});
