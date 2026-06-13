// Guards the decision to keep a separate stack-map copy in each half of the repo
// (CLI: src/stack-map.ts, workflows: pack/lib/stack-map.ts). Both parse the same
// fixtures to the same result, so the two copies can never silently drift apart.
import { describe, expect, test } from "bun:test";
import { createStackMap as createCli, parseStackMap as parseCli } from "../src/stack-map";
import { createStackMap as createPack, parseStackMap as parsePack } from "../pack/lib/stack-map";

const FULL_FIXTURE = {
  version: 1,
  feature: "checkout",
  repoSlug: "app-abc12345",
  baseBranch: "develop",
  tipBranch: "feat/eng-102",
  engine: "jj",
  source: { linearProjectId: "PROJ-1", issueIds: ["ENG-100", "ENG-101", "ENG-102"] },
  entries: [
    { position: 0, issueId: "ENG-100", issueTitle: "Bottom", branchName: "feat/eng-100", changeId: "c0", baseBranch: "develop", headSha: "aaa", status: "merged" },
    { position: 1, issueId: "ENG-101", issueTitle: "Middle", branchName: "feat/eng-101", changeId: "c1", baseBranch: "feat/eng-100", headSha: "bbb", status: "pr-open", prNumber: 1240, prUrl: "https://x/1240" },
    { position: 2, issueId: "ENG-102", issueTitle: "Top", branchName: "feat/eng-102", changeId: "c2", baseBranch: "feat/eng-101", headSha: "ccc", status: "implemented" },
  ],
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z",
};

// Minimal fixture: exercises both schemas' defaulting (status, changeId, engine, baseBranch, ...).
const MINIMAL_FIXTURE = {
  version: 1,
  feature: "x",
  repoSlug: "x-1",
  source: { issueIds: ["ENG-1"] },
  entries: [{ position: 0, issueId: "ENG-1", branchName: "feat/eng-1", baseBranch: "main" }],
  createdAt: "t",
  updatedAt: "t",
};

// The two StackMap types differ only in readonly-ness (CLI interface vs pack z.infer),
// so we compare serialized JSON: identical strings prove identical structure + key order.
describe("stack-map CLI/pack contract", () => {
  test("both halves parse the full fixture identically", () => {
    expect(JSON.stringify(parsePack(FULL_FIXTURE))).toBe(JSON.stringify(parseCli(FULL_FIXTURE)));
  });

  test("both halves apply identical defaults to a minimal fixture", () => {
    expect(JSON.stringify(parsePack(MINIMAL_FIXTURE))).toBe(JSON.stringify(parseCli(MINIMAL_FIXTURE)));
  });

  test("both halves construct identical maps", () => {
    const now = new Date("2026-06-13T12:00:00.000Z");
    const options = {
      feature: "checkout",
      repoSlug: "app-abc12345",
      baseBranch: "main",
      source: { issueIds: ["ENG-100"] },
      entries: [
        {
          position: 0,
          issueId: "ENG-100",
          issueTitle: "Bottom",
          branchName: "feat/eng-100",
          changeId: "",
          baseBranch: "main",
          headSha: "",
          status: "pending" as const,
        },
      ],
    };
    expect(JSON.stringify(createPack(options, now))).toBe(JSON.stringify(createCli(options, now)));
  });
});
