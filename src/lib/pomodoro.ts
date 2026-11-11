// Shared pomodoro persistence helpers. The timer state is stored in a cookie
// (not localStorage) so the server can read it during the initial render and
// paint the continued time immediately — no flash of the default while the
// client hydrates. Both the server (parse) and client (serialize) use these.

export const POMO_COOKIE = "pomodoro";
export const DEFAULT_POMO_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;

export type PomoPhase = "focus" | "break";

// How the timer is drawn. "ring" is the original face and stays the default.
export const POMO_FACES = ["ring", "flip", "digits"] as const;
export type PomoFace = (typeof POMO_FACES)[number];

// The timer's own colour. Empty means "match the app's accent"; the named ones
// are the same ramps the Accent setting uses, plus a monochrome "Ink".
// Stroke of the ring face, in the ring's own units (its box is 340 across).
// 4 is the original hairline; 20 is as thick as fits inside that box.
export const RING_WIDTH_MIN = 2;
export const RING_WIDTH_MAX = 20;
export const DEFAULT_RING_WIDTH = 4;

export const POMO_COLORS = ["", "Sage", "Indigo", "Clay", "Plum", "Ink"] as const;
export type PomoColor = (typeof POMO_COLORS)[number];

export type PomoState = {
  minutes: number;
  breakMinutes: number;
  phase: PomoPhase;
  remain: number;
  running: boolean;
  taskName: string | null;
  taskChosen: boolean;
  // Display choices ride in the same cookie as the timer so the server renders
  // the chosen face straight away instead of flashing the default one.
  face: PomoFace;
  color: PomoColor;
  ringWidth: number;
};

type StoredPomo = {
  minutes?: number;
  breakMinutes?: number;
  phase?: PomoPhase;
  remain?: number;
  running?: boolean;
  taskName?: string | null;
  taskChosen?: boolean;
  face?: string;
  color?: string;
  ringWidth?: number;
  // Absolute epoch ms when a running timer hits zero; lets us recompute the
  // remaining seconds against the current clock instead of freezing.
  endsAt?: number | null;
};

function defaultState(): PomoState {
  return {
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
  };
}

// Turn a raw (URI-encoded) cookie value into the live initial state. For a
// running timer the remaining seconds are derived from `endsAt` so they reflect
// real elapsed time — on a refresh, or after the tab was closed for a while.
export function parsePomoState(raw: string | undefined | null, now = Date.now()): PomoState {
  if (!raw) return defaultState();

  let json = raw;
  try {
    json = decodeURIComponent(raw);
  } catch {
    // Not URI-encoded (or malformed) — fall back to the raw value.
  }

  let s: StoredPomo;
  try {
    s = JSON.parse(json);
  } catch {
    return defaultState();
  }

  const minutes = typeof s.minutes === "number" ? s.minutes : DEFAULT_POMO_MINUTES;
  const breakMinutes = typeof s.breakMinutes === "number" ? s.breakMinutes : DEFAULT_BREAK_MINUTES;
  const phase: PomoPhase = s.phase === "break" ? "break" : "focus";
  const taskChosen = !!s.taskChosen;
  const taskName = taskChosen ? (s.taskName ?? null) : null;
  // A cookie is user-editable and outlives releases, so anything unrecognised
  // falls back to the default rather than reaching the UI.
  const face = POMO_FACES.find((f) => f === s.face) ?? "ring";
  const color = POMO_COLORS.find((c) => c === s.color) ?? "";
  const ringWidth =
    typeof s.ringWidth === "number" && Number.isFinite(s.ringWidth)
      ? Math.min(RING_WIDTH_MAX, Math.max(RING_WIDTH_MIN, Math.round(s.ringWidth)))
      : DEFAULT_RING_WIDTH;

  let remain = (phase === "break" ? breakMinutes : minutes) * 60;
  let running = false;
  if (s.running && typeof s.endsAt === "number") {
    const left = Math.round((s.endsAt - now) / 1000);
    if (left > 0) {
      remain = left;
      running = true;
    } else {
      // Finished while the tab was gone: land on a completed timer.
      remain = 0;
    }
  } else if (typeof s.remain === "number") {
    remain = s.remain;
  }

  return { minutes, breakMinutes, phase, remain, running, taskName, taskChosen, face, color, ringWidth };
}

// Serialize live state for the cookie, anchoring a running timer to an absolute
// end timestamp so it can be restored against the clock later.
export function serializePomoState(s: PomoState, now = Date.now()): string {
  const stored: StoredPomo = {
    minutes: s.minutes,
    breakMinutes: s.breakMinutes,
    phase: s.phase,
    remain: s.remain,
    running: s.running,
    taskName: s.taskName,
    taskChosen: s.taskChosen,
    face: s.face,
    color: s.color,
    ringWidth: s.ringWidth,
    endsAt: s.running ? now + s.remain * 1000 : null,
  };
  return JSON.stringify(stored);
}
