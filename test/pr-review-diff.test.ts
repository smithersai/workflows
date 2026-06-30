import { describe, expect, test } from "bun:test";
import { parseDiffLineMap } from "../src/github";

describe("parseDiffLineMap", () => {
  test("records added and context lines on the new side, skips deletions", () => {
    const diff = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "index 1111111..2222222 100644",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -10,4 +10,5 @@ function login() {",
      " const a = 1;", // context  -> new line 10
      "-const old = 2;", // deletion -> not counted, no new-line advance
      "+const b = 2;", // added    -> new line 11
      "+const c = 3;", // added    -> new line 12
      " return a;", // context  -> new line 13
    ].join("\n");

    const map = parseDiffLineMap(diff);
    const lines = map.get("src/auth.ts");
    expect(lines).toBeDefined();
    expect([...(lines ?? [])].sort((x, y) => x - y)).toEqual([10, 11, 12, 13]);
  });

  test("handles multiple files and multiple hunks", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,2 @@",
      " x",
      "+y",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -20,0 +21,1 @@",
      "+added",
      "@@ -40,1 +50,2 @@",
      " ctx",
      "+more",
    ].join("\n");

    const map = parseDiffLineMap(diff);
    expect([...(map.get("a.ts") ?? [])].sort((x, y) => x - y)).toEqual([1, 2]);
    expect([...(map.get("b.ts") ?? [])].sort((x, y) => x - y)).toEqual([21, 50, 51]);
  });

  test("skips added files (/dev/null source) only by their new-side path, and the no-newline marker", () => {
    const diff = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
      "\\ No newline at end of file",
    ].join("\n");

    const map = parseDiffLineMap(diff);
    expect([...(map.get("new.ts") ?? [])].sort((x, y) => x - y)).toEqual([1, 2]);
  });
});
