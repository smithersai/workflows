import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  baseBranchFor,
  createStackMap,
  descendantsOf,
  entriesToPush,
  findEntryByBranch,
  findEntryByIssue,
  findEntryByPosition,
  loadStackMap,
  nextUnbuiltEntry,
  parsePlanFile,
  parseStackMap,
  planToEntries,
  previousEntry,
  repoSlugFor,
  resolveStackMapPath,
  saveStackMap,
  setTip,
  slugifyFeature,
  updateEntry,
} from "../src/stack-map";
import type { StackEntry, StackMap, StackStatus } from "../src/types";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value, got undefined");
  return value;
}

function entry(position: number, status: StackStatus, extra: Partial<StackEntry> = {}): StackEntry {
  return {
    position,
    issueId: `ENG-${100 + position}`,
    issueTitle: `Issue ${position}`,
    repo: "app",
    branchName: `feat/eng-${100 + position}`,
    changeId: `chg${position}`,
    baseBranch: position === 0 ? "main" : `feat/eng-${100 + position - 1}`,
    headSha: "",
    status,
    ...extra,
  };
}

function mapWith(statuses: readonly StackStatus[]): StackMap {
  return createStackMap({
    feature: "checkout",
    repoSlug: "app-abc12345",
    repos: { app: { path: "/code/app", baseBranch: "main" } },
    source: { issueIds: statuses.map((_, i) => `ENG-${100 + i}`) },
    entries: statuses.map((status, i) => entry(i, status)),
  });
}

describe("parseStackMap", () => {
  test("applies defaults and round-trips a valid map", () => {
    const map = parseStackMap({
      version: 1,
      feature: "checkout",
      repoSlug: "app-abc12345",
      repos: { app: { path: "/code/app", baseBranch: "main" } },
      source: { issueIds: ["ENG-100"] },
      entries: [{ position: 0, issueId: "ENG-100", repo: "app", branchName: "feat/eng-100", baseBranch: "main" }],
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
    });
    expect(map.repos.app?.baseBranch).toBe("main");
    expect(map.engine).toBe("jj");
    expect(map.entries[0]?.status).toBe("pending");
    expect(map.entries[0]?.changeId).toBe("");
  });

  test("rejects an unknown status", () => {
    expect(() =>
      parseStackMap({
        version: 1,
        feature: "x",
        repoSlug: "x",
        source: { issueIds: [] },
        entries: [{ position: 0, issueId: "ENG-1", repo: "app", branchName: "b", baseBranch: "main", status: "wat" }],
        createdAt: "t",
        updatedAt: "t",
      }),
    ).toThrow();
  });

  test("rejects a wrong version", () => {
    expect(() =>
      parseStackMap({ version: 2, feature: "x", repoSlug: "x", source: { issueIds: [] }, createdAt: "t", updatedAt: "t" }),
    ).toThrow();
  });
});

describe("slugs and paths", () => {
  test("repoSlugFor is stable and path-sensitive", () => {
    expect(repoSlugFor("/Users/me/code/app")).toBe(repoSlugFor("/Users/me/code/app"));
    expect(repoSlugFor("/Users/me/code/app")).not.toBe(repoSlugFor("/Users/other/app"));
    expect(repoSlugFor("/Users/me/code/app")).toStartWith("app-");
  });

  test("slugifyFeature normalizes and rejects empty", () => {
    expect(slugifyFeature("Checkout Flow v2!")).toBe("checkout-flow-v2");
    expect(() => slugifyFeature("!!!")).toThrow();
  });

  test("resolveStackMapPath composes home, repo slug, and feature", () => {
    const path = resolveStackMapPath("/home/.smithers", "/Users/me/code/app", "Checkout Flow");
    expect(path).toBe(join("/home/.smithers", "stacks", repoSlugFor("/Users/me/code/app"), "checkout-flow.json"));
  });
});

describe("persistence", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "xiv-stack-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("save then load round-trips and stamps updatedAt", async () => {
    const path = join(dir, "feature.json");
    const map = mapWith(["pending", "pending"]);
    await saveStackMap(path, map, new Date("2026-06-13T12:00:00.000Z"));

    const onDisk = await readFile(path, "utf8");
    expect(onDisk.endsWith("\n")).toBe(true);

    const loaded = await loadStackMap(path);
    expect(loaded?.updatedAt).toBe("2026-06-13T12:00:00.000Z");
    expect(loaded?.entries).toHaveLength(2);
  });

  test("loadStackMap returns null for a missing file", async () => {
    expect(await loadStackMap(join(dir, "nope.json"))).toBeNull();
  });
});

describe("queries", () => {
  test("locates entries by issue, branch, and position", () => {
    const map = mapWith(["implemented", "pending"]);
    expect(findEntryByIssue(map, "ENG-101")?.position).toBe(1);
    expect(findEntryByBranch(map, "feat/eng-100")?.issueId).toBe("ENG-100");
    expect(findEntryByPosition(map, 1)?.issueId).toBe("ENG-101");
    expect(findEntryByIssue(map, "ENG-999")).toBeUndefined();
  });

  test("previousEntry and baseBranchFor follow the stack", () => {
    const map = mapWith(["implemented", "implemented", "pending"]);
    const top = must(findEntryByPosition(map, 2));
    expect(previousEntry(map, top)?.position).toBe(1);
    expect(baseBranchFor(map, top)).toBe("feat/eng-101");
    const bottom = must(findEntryByPosition(map, 0));
    expect(previousEntry(map, bottom)).toBeUndefined();
    expect(baseBranchFor(map, bottom)).toBe("main");
  });

  test("descendantsOf returns higher entries in order", () => {
    const map = mapWith(["implemented", "pending", "pending"]);
    const bottom = must(findEntryByPosition(map, 0));
    expect(descendantsOf(map, bottom).map((e) => e.position)).toEqual([1, 2]);
  });

  test("nextUnbuiltEntry picks the lowest pending/implementing entry", () => {
    expect(nextUnbuiltEntry(mapWith(["implemented", "implementing", "pending"]))?.position).toBe(1);
    expect(nextUnbuiltEntry(mapWith(["merged", "pushed"]))).toBeUndefined();
  });
});

describe("entriesToPush", () => {
  test("returns the contiguous built run above already-published entries", () => {
    const map = mapWith(["merged", "pushed", "implemented", "implemented", "pending"]);
    expect(entriesToPush(map, "app", 10).map((e) => e.position)).toEqual([2, 3]);
  });

  test("respects the count cap", () => {
    const map = mapWith(["implemented", "implemented", "implemented"]);
    expect(entriesToPush(map, "app", 2).map((e) => e.position)).toEqual([0, 1]);
  });

  test("refuses to push past an unbuilt base", () => {
    expect(entriesToPush(mapWith(["pending", "implemented"]), "app", 5)).toEqual([]);
  });
});

describe("updates", () => {
  test("updateEntry patches a matching entry immutably", () => {
    const map = mapWith(["pending"]);
    const next = updateEntry(map, "ENG-100", { status: "implemented", headSha: "abc123" });
    expect(next.entries[0]?.status).toBe("implemented");
    expect(next.entries[0]?.headSha).toBe("abc123");
    expect(map.entries[0]?.status).toBe("pending"); // original untouched
  });

  test("updateEntry throws when the issue is absent", () => {
    expect(() => updateEntry(mapWith(["pending"]), "ENG-999", { status: "merged" })).toThrow("ENG-999");
  });

  test("setTip records the per-repo preview branch", () => {
    expect(setTip(mapWith(["pending"]), "app", "feat/eng-105").tips.app).toBe("feat/eng-105");
  });
});

describe("planToEntries", () => {
  const repos = {
    api: { path: "/code/api", baseBranch: "main" },
    web: { path: "/code/web", baseBranch: "develop" },
  };

  test("assigns positions and computes WITHIN-repo bases across an interleaved order", () => {
    const entries = planToEntries(
      [
        { issueId: "ENG-1", repo: "api" },
        { issueId: "ENG-2", repo: "web" },
        { issueId: "ENG-3", repo: "api" },
      ],
      repos,
    );
    expect(entries.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(entries[0]).toMatchObject({ repo: "api", branchName: "feat/eng-1", baseBranch: "main" });
    expect(entries[1]).toMatchObject({ repo: "web", branchName: "feat/eng-2", baseBranch: "develop" });
    // ENG-3 stacks on ENG-1 (previous *api* entry), not ENG-2 (a web entry between them).
    expect(entries[2]).toMatchObject({ repo: "api", branchName: "feat/eng-3", baseBranch: "feat/eng-1" });
  });

  test("falls back to the first repo for an unknown key", () => {
    expect(planToEntries([{ issueId: "ENG-9", repo: "ghost" }], repos)[0]?.repo).toBe("api");
  });
});

describe("parsePlanFile", () => {
  test("parses order and excluded", () => {
    const plan = parsePlanFile({
      order: [{ issueId: "ENG-1", repo: "api", title: "schema" }],
      excluded: [{ issueId: "ENG-9", reason: "infra/manual" }],
    });
    expect(plan.order).toHaveLength(1);
    expect(plan.excluded?.[0]?.issueId).toBe("ENG-9");
  });

  test("rejects an order entry missing a repo", () => {
    expect(() => parsePlanFile({ order: [{ issueId: "ENG-1" }] })).toThrow();
  });
});
