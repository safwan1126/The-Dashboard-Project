// Regression cover for the "Up next" widget staying empty.
//
// The widget is fed by a batched /api/calendar request that is deduped by day
// list. When the dedup turned a second caller away instead of sharing the
// pending request, React StrictMode's double-invoked effects meant neither pass
// ever committed the result and the card never rendered. These tests mount the
// real component in StrictMode, which is how the app runs in development.

import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// vi.mock factories are hoisted above the module body, so each one builds its
// own stubs rather than closing over a shared const.
vi.mock("@/lib/microsoft/syncTasks", () => ({
  syncTasksToMicrosoft: vi.fn(async () => ({ success: true })),
  deleteTaskFromMicrosoft: vi.fn(async () => undefined),
}));
vi.mock("@/lib/data/habits", () => ({
  addHabit: vi.fn(async () => undefined),
  deleteHabit: vi.fn(async () => undefined),
  updateHabitFrequency: vi.fn(async () => undefined),
  toggleHabitToday: vi.fn(async () => 0),
}));
vi.mock("@/lib/data/pomoSessions", () => ({
  addPomoSession: vi.fn(async () => undefined),
}));
vi.mock("@/lib/data/notes", () => ({
  addNote: vi.fn(async () => undefined),
  updateNoteBody: vi.fn(async () => undefined),
  deleteNote: vi.fn(async () => undefined),
  addNoteImages: vi.fn(async () => undefined),
  removeNoteImage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/settings/actions", () => ({
  updateProfileName: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  disconnectMicrosoft: vi.fn(async () => undefined),
  disconnectGoogle: vi.fn(async () => undefined),
}));

import Dashboard from "./Dashboard";
import { parsePomoState } from "@/lib/pomodoro";

function isoOf(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// An event late enough in the day that "now" is always before it ends,
// so the widget has something upcoming to show whenever the suite runs.
const LATE_EVENT = {
  id: "evt-1",
  title: "Design review",
  start: "23:30",
  end: "23:59",
  startMin: 23 * 60 + 30,
  endMin: 23 * 60 + 59,
  allDay: false,
};

function renderDashboard() {
  return render(
    <StrictMode>
      <Dashboard
        email="test@example.com"
        name="Test"
        microsoftConnected={false}
        googleConnected
        initialHabits={[]}
        initialHabitCompletions={[]}
        initialNotes={[]}
        initialPomo={parsePomoState(undefined)}
      />
    </StrictMode>
  );
}

let calendarCalls = 0;

beforeEach(() => {
  calendarCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/calendar")) {
      calendarCalls++;
      const days = new URLSearchParams(url.split("?")[1]).get("days")!.split(",");
      const todayISO = isoOf(new Date());
      const byDay = Object.fromEntries(
        days.map((iso) => [iso, iso === todayISO ? [LATE_EVENT] : []])
      );
      return new Response(JSON.stringify({ status: "ok", days: byDay }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Task and pomodoro reads: empty is fine, they are not under test here.
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
});

afterEach(() => {
  // This project's vitest config doesn't enable `globals`, so RTL's automatic
  // cleanup isn't registered — unmount explicitly or renders pile up in the DOM
  // and later queries match several trees at once.
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Up next widget", () => {
  it("renders the next event under StrictMode's double-invoked effects", async () => {
    renderDashboard();

    // The regression: both effect passes discarded the result, so this never
    // appeared.
    expect(await screen.findByText("Next Up")).toBeInTheDocument();

    // Scoped to the widget — the same event also shows in the calendar day
    // view, which is fed from the very same batched response.
    expect(document.querySelector(".next-up-title-inline")).toHaveTextContent("Design review");
    expect(document.querySelector(".cal-block-title")).toHaveTextContent("Design review");
  });

  it("still issues only one calendar request despite the double mount", async () => {
    renderDashboard();

    await screen.findByText("Next Up");
    // Deduped, not merely working: the two passes share one request.
    await waitFor(() => expect(calendarCalls).toBe(1));
  });

  it("asks for today and tomorrow in the same batch as the visible week", async () => {
    renderDashboard();
    await screen.findByText("Next Up");

    const calendarUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.startsWith("/api/calendar"))!;

    const days = new URLSearchParams(calendarUrl.split("?")[1]).get("days")!.split(",");
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(days).toContain(isoOf(today));
    expect(days).toContain(isoOf(tomorrow));
  });
});
