import { describe, expect, test } from "bun:test";
import {
  implementInput,
  parseInput,
  resolveWorkflowPath,
  reviewInput,
  shipInput,
  stackAmendInput,
  stackBuildInput,
  stackPlanInput,
  stackPushInput,
} from "../src/smithers";

describe("workflow input builders", () => {
  test("builds implement input", () => {
    expect(implementInput({ issueId: "ENG-123", tdd: true })).toEqual({
      issueId: "ENG-123",
      tdd: true,
    });
  });

  test("builds attach-to-pr review input", () => {
    expect(reviewInput({ prNumber: 1234, base: "main" })).toEqual({
      prNumber: 1234,
      base: "main",
    });
  });

  test("builds branch review input", () => {
    expect(reviewInput({ branch: "feat/eng-123", base: "develop" })).toEqual({
      branch: "feat/eng-123",
      base: "develop",
    });
  });

  test("builds ship input", () => {
    expect(shipInput({ issueId: "ENG-123", base: "main", tdd: false })).toEqual({
      issueId: "ENG-123",
      base: "main",
      tdd: false,
    });
  });

  test("builds stack plan input", () => {
    expect(
      stackPlanInput({
        source: "PROJ-1",
        feature: "checkout",
        base: "main",
        repoSlug: "app-abc12345",
        stackMapPath: "/home/.smithers/stacks/app/checkout.json",
      }),
    ).toEqual({
      source: "PROJ-1",
      feature: "checkout",
      base: "main",
      repoSlug: "app-abc12345",
      stackMapPath: "/home/.smithers/stacks/app/checkout.json",
    });
  });

  test("builds stack build input", () => {
    expect(stackBuildInput({ stackMapPath: "/p/checkout.json" })).toEqual({ stackMapPath: "/p/checkout.json" });
  });

  test("builds stack amend input with and without an explicit target", () => {
    expect(stackAmendInput({ stackMapPath: "/p/checkout.json", message: "make it blue", target: "ENG-105" })).toEqual({
      stackMapPath: "/p/checkout.json",
      message: "make it blue",
      target: "ENG-105",
    });
    expect(stackAmendInput({ stackMapPath: "/p/checkout.json", message: "make it blue" })).toEqual({
      stackMapPath: "/p/checkout.json",
      message: "make it blue",
    });
  });

  test("builds stack push input", () => {
    expect(stackPushInput({ stackMapPath: "/p/checkout.json", count: 5 })).toEqual({
      stackMapPath: "/p/checkout.json",
      count: 5,
    });
  });
});

describe("parseInput", () => {
  test("parses a JSON object", () => {
    expect(parseInput('{"issueId":"ENG-123","tdd":true}')).toEqual({ issueId: "ENG-123", tdd: true });
  });

  test("defaults empty object", () => {
    expect(parseInput("{}")).toEqual({});
  });

  test("rejects non-object JSON", () => {
    expect(() => parseInput("[1,2,3]")).toThrow("--input must be a JSON object");
    expect(() => parseInput("42")).toThrow("--input must be a JSON object");
    expect(() => parseInput("null")).toThrow("--input must be a JSON object");
  });

  test("propagates invalid JSON", () => {
    expect(() => parseInput("{not json}")).toThrow();
  });
});

describe("resolveWorkflowPath", () => {
  test("expands a bare workflow name", () => {
    expect(resolveWorkflowPath("linear-implement")).toBe("workflows/linear-implement.tsx");
  });

  test("passes through a .tsx path unchanged", () => {
    expect(resolveWorkflowPath("workflows/linear-implement.tsx")).toBe("workflows/linear-implement.tsx");
  });

  test("passes through an absolute path unchanged", () => {
    expect(resolveWorkflowPath("/abs/path/to/wf.tsx")).toBe("/abs/path/to/wf.tsx");
  });
});
