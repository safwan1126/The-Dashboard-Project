import { describe, expect, it } from "vitest";
import { computeStreak } from "./habitStreak";

// Wednesday, so day-of-week math below is unambiguous.
const WED = new Date(2026, 7, 19); // 2026-08-19

describe("computeStreak", () => {
  it("is 0 for a habit with no scheduled days", () => {
    expect(computeStreak([], new Set(), WED)).toBe(0);
  });

  it("is 0 when nothing has been completed", () => {
    // Scheduled every day.
    expect(computeStreak([0, 1, 2, 3, 4, 5, 6], new Set(), WED)).toBe(0);
  });

  it("counts consecutive completed scheduled days ending yesterday when today isn't done yet", () => {
    const dates = new Set(["2026-08-18", "2026-08-17", "2026-08-16"]);
    // Scheduled every day; today (Wed) not yet completed, so streak counts back from yesterday.
    expect(computeStreak([0, 1, 2, 3, 4, 5, 6], dates, WED)).toBe(3);
  });

  it("includes today when today is already completed", () => {
    const dates = new Set(["2026-08-19", "2026-08-18"]);
    expect(computeStreak([0, 1, 2, 3, 4, 5, 6], dates, WED)).toBe(2);
  });

  it("stops at the first missed scheduled day", () => {
    // Completed yesterday (Tue), but the day before that (Mon) is missing —
    // walking further back to Sun's completion doesn't extend the streak.
    const dates = new Set(["2026-08-18", "2026-08-16"]);
    expect(computeStreak([0, 1, 2, 3, 4, 5, 6], dates, WED)).toBe(1);
  });

  it("only counts days the habit is actually scheduled for", () => {
    // Scheduled Mon/Wed/Fri (1, 3, 5) only.
    const frequency = [1, 3, 5];
    // Completed last Mon, Wed, Fri; today (Wed) not done yet.
    const dates = new Set(["2026-08-17", "2026-08-14", "2026-08-12"]);
    expect(computeStreak(frequency, dates, WED)).toBe(3);
  });
});
