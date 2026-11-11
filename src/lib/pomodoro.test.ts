import { describe, expect, it } from "vitest";
import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_POMO_MINUTES,
  DEFAULT_RING_WIDTH,
  RING_WIDTH_MAX,
  RING_WIDTH_MIN,
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
      face: "ring",
      color: "",
      ringWidth: DEFAULT_RING_WIDTH,
      backdrop: "glow",
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
      face: "flip",
      color: "Clay",
      ringWidth: 12,
      backdrop: "tide",
    };
    const raw = serializePomoState(state, now);
    expect(parsePomoState(raw, now)).toEqual(state);
  });

  it("keeps the ring face and the app's accent for a cookie written before display options existed", () => {
    const raw = JSON.stringify({ minutes: 25, breakMinutes: 5, phase: "focus", remain: 600 });
    expect(parsePomoState(raw)).toMatchObject({ face: "ring", color: "", ringWidth: DEFAULT_RING_WIDTH });
  });

  it("keeps the ring thickness inside what the ring can draw", () => {
    const width = (ringWidth: unknown) => parsePomoState(JSON.stringify({ ringWidth })).ringWidth;

    expect(width(12)).toBe(12);
    expect(width(7.6)).toBe(8);
    // Thicker than this and the stroke would be clipped by the ring's own box.
    expect(width(500)).toBe(RING_WIDTH_MAX);
    expect(width(0)).toBe(RING_WIDTH_MIN);
    expect(width("thick")).toBe(DEFAULT_RING_WIDTH);
  });

  it("falls back to the defaults for a face, colour or backdrop it does not recognise", () => {
    const raw = JSON.stringify({ face: "hourglass", color: "Chartreuse", backdrop: "lava" });
    expect(parsePomoState(raw)).toMatchObject({ face: "ring", color: "", backdrop: "glow" });
  });
});
