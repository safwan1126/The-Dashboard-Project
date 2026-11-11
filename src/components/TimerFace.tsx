"use client";

// The focus timer's display. One component, three faces: the original ring, a
// flip clock, and large plain digits. All three show the same things — the
// phase, the time left, the task, and how far through the phase you are — so
// switching face never changes what the timer tells you.

import { useState } from "react";
import { DEFAULT_RING_WIDTH, type PomoFace, type PomoPhase } from "@/lib/pomodoro";

// Ring geometry, in SVG user units. The SVG scales to its container.
const RING_R = 160;
const RING_SIZE = RING_R * 2 + 20;
const RING_C = RING_SIZE / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// One card of the flip clock. When the digit changes, the old top half falls
// away to reveal the new one, then the new bottom half swings down over the
// old. The flaps are keyed by the digit so the animation restarts each time,
// and once the bottom flap has landed the card settles back to two plain
// halves, so no flap lingers stacked on top of another.
function FlipDigit({ value }: { value: string }) {
  // The previous digit is derived during render, React's pattern for state
  // that follows a prop, so the flaps have something to fall away from.
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState(value);
  if (value !== current) {
    setPrevious(current);
    setCurrent(value);
  }
  const flipping = previous !== current;

  return (
    <span className="flip-digit">
      <span className="flip-half flip-top"><span>{current}</span></span>
      <span className="flip-half flip-bottom"><span>{flipping ? previous : current}</span></span>
      {flipping && (
        <>
          <span key={`t${current}`} className="flip-half flip-top flip-flap-top"><span>{previous}</span></span>
          <span
            key={`b${current}`}
            className="flip-half flip-bottom flip-flap-bottom"
            onAnimationEnd={() => setPrevious(current)}
          >
            <span>{current}</span>
          </span>
        </>
      )}
    </span>
  );
}

// Keyed from the right-hand end, so a digit keeps its card (and its animation
// state) even if a longer minute count adds one on the left.
function FlipGroup({ text }: { text: string }) {
  const chars = text.split("");
  return (
    <span className="flip-group">
      {chars.map((c, i) => (
        <FlipDigit key={chars.length - i} value={c} />
      ))}
    </span>
  );
}

export default function TimerFace({
  face,
  remain,
  total,
  phase,
  task,
  ringWidth = DEFAULT_RING_WIDTH,
}: {
  face: PomoFace;
  /** Seconds left in the current phase. */
  remain: number;
  /** Length of the current phase, in seconds. */
  total: number;
  phase: PomoPhase;
  /** The task being focused on, if one was chosen. */
  task: string | null;
  /** Stroke of the ring face, in ring units. Ignored by the other faces. */
  ringWidth?: number;
}) {
  const minutes = pad(Math.floor(remain / 60));
  const seconds = pad(remain % 60);
  const mode = phase === "break" ? "Break" : "Focus";
  const elapsed = total > 0 ? Math.min(1, Math.max(0, 1 - remain / total)) : 0;
  // Spoken once on focus rather than every second: role="timer" is not live.
  const spoken = `${mode}, ${minutes} minutes ${seconds} seconds left`;

  if (face === "ring") {
    return (
      <div className="pomo-page-ring" role="timer" aria-label={spoken}>
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
          <circle cx={RING_C} cy={RING_C} r={RING_R} fill="none" stroke="oklch(var(--tint) / 0.08)" strokeWidth={ringWidth} />
          <circle
            className="timer-ring-mark"
            cx={RING_C} cy={RING_C} r={RING_R} fill="none" strokeWidth={ringWidth}
            strokeLinecap="round" strokeDasharray={RING_CIRC} strokeDashoffset={(RING_CIRC * (1 - elapsed)).toFixed(1)}
            style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
          />
        </svg>
        <div className="pomo-page-center">
          <div className="pomo-page-mode">{mode}</div>
          <div className="pomo-page-time num">{minutes}:{seconds}</div>
          {task && <div className="pomo-page-task-label">{task}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={"timer-face timer-" + face} role="timer" aria-label={spoken}>
      <div className="pomo-page-mode">{mode}</div>
      {face === "flip" ? (
        // Each card draws its digit up to four times over, so the cards are
        // hidden from assistive tech and the label above speaks for them.
        <div className="flip-clock" aria-hidden="true">
          <FlipGroup text={minutes} />
          <span className="flip-colon"><i /><i /></span>
          <FlipGroup text={seconds} />
        </div>
      ) : (
        <div className="timer-digits-time">{minutes}:{seconds}</div>
      )}
      {task && <div className="pomo-page-task-label">{task}</div>}
      <div className="timer-progress" aria-hidden="true">
        <i style={{ width: `${(elapsed * 100).toFixed(2)}%` }} />
      </div>
    </div>
  );
}
