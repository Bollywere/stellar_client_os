import { describe, expect, it } from "vitest";
import {
  easeOutCubic,
  formatFunding,
  fundingPercent,
  tweenFundingValue,
} from "./funding-counter";

describe("easeOutCubic", () => {
  it("is monotonic and anchored at the endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("decelerates toward the end (fast start, gentle landing)", () => {
    const deltaAt = (t: number) => easeOutCubic(t + 0.05) - easeOutCubic(t);
    expect(deltaAt(0)).toBeGreaterThan(deltaAt(0.9));
  });

  it("clamps out-of-range inputs", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(1.5)).toBe(1);
  });
});

describe("formatFunding", () => {
  it("groups thousands the way the campaign page displays amounts", () => {
    expect(formatFunding(33850)).toBe("33,850");
    expect(formatFunding(0)).toBe("0");
    expect(formatFunding(1_234_567)).toBe("1,234,567");
  });

  it("rounds fractional animated values instead of showing decimals", () => {
    expect(formatFunding(33849.6)).toBe("33,850");
  });

  it("degrades non-finite values to 0", () => {
    expect(formatFunding(Number.NaN)).toBe("0");
  });
});

describe("tweenFundingValue", () => {
  it("starts at from and lands exactly on to", () => {
    expect(tweenFundingValue(100, 250, 0)).toBe(100);
    expect(tweenFundingValue(100, 250, 1)).toBe(250);
  });

  it("never overshoots the target mid-tween", () => {
    for (let t = 0; t <= 1; t += 0.1) {
      expect(tweenFundingValue(100, 250, t)).toBeLessThanOrEqual(250);
      expect(tweenFundingValue(250, 100, t)).toBeGreaterThanOrEqual(100);
    }
  });

  it("tolerates non-finite inputs", () => {
    expect(tweenFundingValue(Number.NaN, 100, 0.5)).toBeCloseTo(50);
    expect(tweenFundingValue(0, Number.NaN, 0.5)).toBe(0);
  });
});

describe("fundingPercent", () => {
  it("matches the page's whole-number clamped percentage", () => {
    expect(fundingPercent(33850, 50000)).toBe(68);
    expect(fundingPercent(60000, 50000)).toBe(100);
    expect(fundingPercent(0, 50000)).toBe(0);
  });

  it("guards against a zero or invalid goal", () => {
    expect(fundingPercent(100, 0)).toBe(0);
    expect(fundingPercent(Number.NaN, 50000)).toBe(0);
  });
});
