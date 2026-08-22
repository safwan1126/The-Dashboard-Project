import { describe, expect, it } from "vitest";
import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_POMO_MINUTES,
  parsePomoState,
  serializePomoState,
  type PomoState,
} from "./pomodoro";

describe("parsePomoState", () => {
  it("returns the default state when there's no cookie", () => {
    expect(parsePomoState(undefined)).toEqual({
      minutes: DEFAULT_POMO_MINUTES,
      breakMinutes: DEFAULT_BREAK_MINUTES,
      phase: "focus",
      remain: DEFAULT_POMO_MINUTES * 60,
      running: false,
      taskName: null,
      taskChosen: false,
    });
  });

  it("returns the default state for malformed JSON", () => {
    expect(parsePomoState("{not json")).toEqual(parsePomoState(undefined));
  });

  it("derives remaining seconds from endsAt for a running timer", () => {
    const now = 1_700_000_000_000;
    const raw = JSON.stringify({
      minutes: 25,
      breakMinutes: 5,
      phase: "focus",
      running: true,
      endsAt: now + 90_000,
    });
    const state = parsePomoState(raw, now);
    expect(state.running).toBe(true);
    expect(state.remain).toBe(90);
  });

  it("lands on a completed, non-running timer if endsAt already passed", () => {
    const now = 1_700_000_000_000;
    const raw = JSON.stringify({
      minutes: 25,
      phase: "focus",
      running: true,
      endsAt: now - 5_000,
    });
    const state = parsePomoState(raw, now);
    expect(state.running).toBe(false);
    expect(state.remain).toBe(0);
  });

  it("uses the stored remain for a paused timer", () => {
    const raw = JSON.stringify({ minutes: 25, phase: "focus", running: false, remain: 400 });
    const state = parsePomoState(raw);
    expect(state.running).toBe(false);
    expect(state.remain).toBe(400);
  });

  it("clears taskName when taskChosen is false", () => {
    const raw = JSON.stringify({ taskChosen: false, taskName: "Write report" });
    expect(parsePomoState(raw).taskName).toBeNull();
  });

  it("round-trips through serializePomoState for a running timer", () => {
    const now = 1_700_000_000_000;
    const state: PomoState = {
      minutes: 25,
      breakMinutes: 5,
      phase: "focus",
      remain: 120,
      running: true,
      taskName: "Deep work",
      taskChosen: true,
    };
    const raw = serializePomoState(state, now);
    expect(parsePomoState(raw, now)).toEqual(state);
  });
});
