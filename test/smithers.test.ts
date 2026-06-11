import { describe, expect, test } from "bun:test";
import { implementInput, reviewInput, shipInput } from "../src/smithers";

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
});
