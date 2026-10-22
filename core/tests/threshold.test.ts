import { describe, expect, it } from "vitest";
import { approvalThreshold, isRealQuorum } from "../src/threshold.js";

describe("S1 approvalThreshold", () => {
  const table: Array<[number, number]> = [
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [10, 7],
  ];

  it.each(table)("adminCount %i -> threshold %i (floor, not ceil/round)", (n, expected) => {
    expect(approvalThreshold(n)).toBe(expected);
  });

  it("never drops below 1 (max(1, ...) clamp)", () => {
    expect(approvalThreshold(1)).toBe(1);
    expect(approvalThreshold(2)).toBe(1);
  });

  it("equals max(1, floor(7n/10)) for n = 1..60", () => {
    for (let n = 1; n <= 60; n++) {
      expect(approvalThreshold(n)).toBe(Math.max(1, Math.floor((7 * n) / 10)));
    }
  });

  it("returns an integer", () => {
    for (let n = 1; n <= 30; n++) {
      expect(Number.isInteger(approvalThreshold(n))).toBe(true);
    }
  });

  it.each([0, -1, -5, 1.5, 2.0000001, NaN, Infinity, -Infinity])(
    "throws RangeError for invalid adminCount %s",
    (bad) => {
      expect(() => approvalThreshold(bad)).toThrow(RangeError);
    },
  );
});

describe("S1 isRealQuorum", () => {
  it.each([
    [1, false],
    [2, false],
    [3, true],
    [4, true],
    [5, true],
    [10, true],
  ])("adminCount %i -> %s", (n, expected) => {
    expect(isRealQuorum(n)).toBe(expected);
  });

  it("propagates RangeError for invalid input", () => {
    expect(() => isRealQuorum(0)).toThrow(RangeError);
    expect(() => isRealQuorum(2.5)).toThrow(RangeError);
  });
});
