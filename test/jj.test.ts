import { describe, expect, test } from "bun:test";
import { jjPreflightError, parseJjVersion } from "../src/jj";
import type { JjPreflight } from "../src/types";

describe("parseJjVersion", () => {
  test("extracts a semantic version", () => {
    expect(parseJjVersion("jj 0.28.0\n")).toBe("0.28.0");
    expect(parseJjVersion("jj 1.10.2-abc (2026-01-01)")).toBe("1.10.2");
  });

  test("returns null when no version is present", () => {
    expect(parseJjVersion("command not found")).toBeNull();
    expect(parseJjVersion("")).toBeNull();
  });
});

describe("jjPreflightError", () => {
  const cwd = "/Users/me/code/app";

  test("flags a missing binary with an install hint", () => {
    const preflight: JjPreflight = { available: false, isRepo: false, version: null };
    const error = jjPreflightError(preflight, cwd);
    expect(error).toContain("not found on PATH");
    expect(error).toContain("brew install jj");
  });

  test("flags a non-jj repo with a colocate hint", () => {
    const preflight: JjPreflight = { available: true, isRepo: false, version: "0.28.0" };
    const error = jjPreflightError(preflight, cwd);
    expect(error).toContain("not a jj repository");
    expect(error).toContain("jj git init --colocate");
  });

  test("returns null when jj is installed and the repo is colocated", () => {
    const preflight: JjPreflight = { available: true, isRepo: true, version: "0.28.0" };
    expect(jjPreflightError(preflight, cwd)).toBeNull();
  });
});
