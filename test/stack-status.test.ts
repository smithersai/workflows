import { describe, expect, test } from "bun:test";
import { createStackMap, setTip } from "../src/stack-map";
import { parseRepoArgs, stackInitAction, stackStatusReport } from "../src/stack";
import type { JjPreflight, StackEntry, StackMap } from "../src/types";

function entry(position: number, patch: Partial<StackEntry> = {}): StackEntry {
  return {
    position,
    issueId: `ENG-${100 + position}`,
    issueTitle: `Issue ${position}`,
    repo: "app",
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
    repos: { app: { path: "/code/app", baseBranch: "main" } },
    source: { issueIds: ["ENG-100", "ENG-101"] },
    entries: [entry(0, { status: "pr-open", prNumber: 1234 }), entry(1, { status: "implemented" })],
  });
}

describe("stackStatusReport", () => {
  test("includes the feature header, the repo group, every entry, and PR numbers", () => {
    const report = stackStatusReport(sampleMap());
    expect(report).toContain("Stack: checkout");
    expect(report).toContain("engine jj");
    expect(report).toContain("repo app");
    expect(report).toContain("ENG-100");
    expect(report).toContain("ENG-101");
    expect(report).toContain("#1234");
    expect(report).toContain("pr-open");
  });

  test("flags an unbuilt tip and a built tip", () => {
    expect(stackStatusReport(sampleMap())).toContain("not built yet");
    const built = setTip(sampleMap(), "app", "feat/eng-101");
    expect(stackStatusReport(built)).toContain("feat/eng-101");
  });
});

describe("stackInitAction", () => {
  const repo = "/Users/me/code/app";
  const preflight = (over: Partial<JjPreflight>): JjPreflight => ({
    available: true,
    isRepo: false,
    version: "0.28.0",
    root: null,
    gitRoot: repo,
    ...over,
  });

  test("install-jj when jj is missing", () => {
    expect(stackInitAction(preflight({ available: false, version: null, gitRoot: null }))).toBe("install-jj");
  });

  test("not-git-repo when cwd is not inside a git repo (e.g. a parent code dir)", () => {
    expect(stackInitAction(preflight({ gitRoot: null }))).toBe("not-git-repo");
  });

  test("ancestor-jj when jj resolves to a parent directory, not this repo", () => {
    expect(stackInitAction(preflight({ isRepo: true, root: "/Users/me/code", gitRoot: repo }))).toBe("ancestor-jj");
  });

  test("already-colocated when jj is rooted at this repo", () => {
    expect(stackInitAction(preflight({ isRepo: true, root: repo, gitRoot: repo }))).toBe("already-colocated");
  });

  test("colocate when jj is present, cwd is a git repo, but not yet a jj repo", () => {
    expect(stackInitAction(preflight({ isRepo: false, root: null, gitRoot: repo }))).toBe("colocate");
  });
});

describe("parseRepoArgs", () => {
  test("defaults to a single repo rooted at cwd when no flags are given", () => {
    expect(parseRepoArgs([], "main", "/Users/me/code/app")).toEqual({
      app: { path: "/Users/me/code/app", baseBranch: "main" },
    });
  });

  test("parses key=path flags, all sharing the given base", () => {
    const repos = parseRepoArgs(["api=/code/api", "web=/code/web"], "develop", "/cwd");
    expect(repos.api).toEqual({ path: "/code/api", baseBranch: "develop" });
    expect(repos.web).toEqual({ path: "/code/web", baseBranch: "develop" });
  });

  test("rejects a flag without key=path", () => {
    expect(() => parseRepoArgs(["nopath"], "main", "/cwd")).toThrow();
  });
});
