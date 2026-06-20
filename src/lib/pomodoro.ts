// Shared pomodoro persistence helpers. The timer state is stored in a cookie
// (not localStorage) so the server can read it during the initial render and
// paint the continued time immediately — no flash of the default while the
// client hydrates. Both the server (parse) and client (serialize) use these.

export const POMO_COOKIE = "pomodoro";
export const DEFAULT_POMO_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;

export type PomoPhase = "focus" | "break";

export type PomoState = {
  minutes: number;
  breakMinutes: number;
  phase: PomoPhase;
  remain: number;
  running: boolean;
  taskName: string | null;
  taskChosen: boolean;
};

type StoredPomo = {
  minutes?: number;
  breakMinutes?: number;
  phase?: PomoPhase;
  remain?: number;
  running?: boolean;
  taskName?: string | null;
  taskChosen?: boolean;
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

  return { minutes, breakMinutes, phase, remain, running, taskName, taskChosen };
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
    endsAt: s.running ? now + s.remain * 1000 : null,
  };
  return JSON.stringify(stored);
}
