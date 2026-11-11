import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TimerFace from "./TimerFace";

// The vitest config doesn't enable globals, so RTL's automatic cleanup is not
// registered; unmount by hand between cases.
afterEach(cleanup);

const base = { remain: 19 * 60 + 43, total: 25 * 60, phase: "focus" as const, task: "Write the spec" };

// The digit each flip card currently shows on its (static) top half.
function cardDigits() {
  return [...document.querySelectorAll(".flip-digit")].map(
    (card) => card.querySelector(":scope > .flip-top:not(.flip-flap-top)")!.textContent
  );
}

describe("TimerFace", () => {
  it.each(["ring", "flip", "digits"] as const)("says the same thing on the %s face", (face) => {
    render(<TimerFace face={face} {...base} />);

    // Whatever the face, the phase, the time left and the task are all there.
    expect(screen.getByRole("timer")).toHaveAccessibleName("Focus, 19 minutes 43 seconds left");
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByText("Write the spec")).toBeInTheDocument();
  });

  it("writes the time out on the ring and digits faces", () => {
    const { rerender } = render(<TimerFace face="ring" {...base} />);
    expect(screen.getByText("19:43")).toBeInTheDocument();

    rerender(<TimerFace face="digits" {...base} />);
    expect(screen.getByText("19:43")).toBeInTheDocument();
  });

  it("names the break phase and leaves the task out when there is none", () => {
    render(<TimerFace face="digits" remain={212} total={300} phase="break" task={null} />);

    expect(screen.getByRole("timer")).toHaveAccessibleName("Break, 03 minutes 32 seconds left");
    expect(document.querySelector(".pomo-page-task-label")).toBeNull();
  });

  it("gives the flip clock one card per digit", () => {
    render(<TimerFace face="flip" {...base} />);
    expect(cardDigits()).toEqual(["1", "9", "4", "3"]);
    // Nothing has changed yet, so nothing should be mid-flip.
    expect(document.querySelector(".flip-flap-top")).toBeNull();
  });

  it("flips only the cards whose digit changed, from the old digit to the new", () => {
    const { rerender } = render(<TimerFace face="flip" {...base} />);
    rerender(<TimerFace face="flip" {...base} remain={base.remain - 1} />);

    expect(cardDigits()).toEqual(["1", "9", "4", "2"]);

    const cards = document.querySelectorAll(".flip-digit");
    // 19:43 -> 19:42 touches the last card alone.
    expect(cards[0].querySelector(".flip-flap-top")).toBeNull();
    expect(cards[2].querySelector(".flip-flap-top")).toBeNull();
    // The falling top flap still carries the old digit; the landing bottom
    // flap carries the new one.
    expect(cards[3].querySelector(".flip-flap-top")).toHaveTextContent("3");
    expect(cards[3].querySelector(".flip-flap-bottom")).toHaveTextContent("2");
  });

  it("carries across the colon when the seconds roll over", () => {
    const { rerender } = render(<TimerFace face="flip" {...base} remain={20 * 60} />);
    rerender(<TimerFace face="flip" {...base} remain={20 * 60 - 1} />);

    expect(cardDigits()).toEqual(["1", "9", "5", "9"]);
    expect(document.querySelectorAll(".flip-flap-top")).toHaveLength(4);
  });

  it("adds a card for a three-digit minute count", () => {
    render(<TimerFace face="flip" remain={120 * 60} total={120 * 60} phase="focus" task={null} />);
    expect(cardDigits()).toEqual(["1", "2", "0", "0", "0"]);
  });

  it("draws the ring, track and mark alike, at the chosen thickness", () => {
    const { rerender } = render(<TimerFace face="ring" {...base} />);
    const widths = () => [...document.querySelectorAll(".pomo-page-ring circle")].map((c) => c.getAttribute("stroke-width"));
    // The original hairline unless told otherwise.
    expect(widths()).toEqual(["4", "4"]);

    rerender(<TimerFace face="ring" {...base} ringWidth={14} />);
    expect(widths()).toEqual(["14", "14"]);
  });

  it("fills the progress bar by the share of the phase that has elapsed", () => {
    render(<TimerFace face="digits" remain={15 * 60} total={25 * 60} phase="focus" task={null} />);
    expect(document.querySelector(".timer-progress > i")).toHaveStyle({ width: "40.00%" });
  });

  it("draws an empty ring at the start and a full one at the end", () => {
    const circumference = 2 * Math.PI * 160;
    const { rerender } = render(<TimerFace face="ring" remain={1500} total={1500} phase="focus" task={null} />);
    const mark = () => document.querySelector(".timer-ring-mark")!;
    // The mark is drawn by shrinking its dash offset from a full circumference.
    expect(Number(mark().getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference, 0);

    rerender(<TimerFace face="ring" remain={0} total={1500} phase="focus" task={null} />);
    expect(Number(mark().getAttribute("stroke-dashoffset"))).toBe(0);
  });
});
