// Cover for renaming a task in place on the "All Tasks" screen.
//
// The name is editable by clicking it; committing with Enter updates local
// state, which the auto-sync effect then pushes to Microsoft To Do. The pin
// flag is keyed by name until a task has a Microsoft id, so a rename has to
// carry the pin across.

import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  // The tasks screen is chosen by the `screen` search param.
  useSearchParams: () => new URLSearchParams("screen=tasks"),
}));

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
vi.mock("@/lib/data/taskPins", () => ({
  setTaskPin: vi.fn(async () => ({ success: true })),
  importTaskPins: vi.fn(async () => ({ success: true })),
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
import { syncTasksToMicrosoft } from "@/lib/microsoft/syncTasks";
import { setTaskPin } from "@/lib/data/taskPins";

const REMOTE_TASK = { id: "ms-1", name: "Water the plants", done: false, pinned: false };

function renderDashboard() {
  return render(
    <StrictMode>
      <Dashboard
        email="test@example.com"
        name="Test"
        microsoftConnected
        googleConnected={false}
        initialHabits={[]}
        initialHabitCompletions={[]}
        initialNotes={[]}
        initialPomo={parsePomoState(undefined)}
      />
    </StrictMode>
  );
}

const syncMock = syncTasksToMicrosoft as unknown as ReturnType<typeof vi.fn>;
const pinMock = setTaskPin as unknown as ReturnType<typeof vi.fn>;

// The names the sync was last asked to push.
function lastSyncedNames(): string[] {
  const call = syncMock.mock.calls.at(-1);
  return (call?.[0] as { name: string }[]).map((t) => t.name);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith("/api/tasks") ? JSON.stringify([REMOTE_TASK]) : "[]";
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
});

afterEach(() => {
  // RTL's automatic cleanup isn't registered without vitest `globals`.
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("renaming a task", () => {
  it("commits the new name on Enter and syncs it", async () => {
    const user = userEvent.setup();
    renderDashboard();

    const name = await screen.findByText("Water the plants");
    await user.click(name);

    const input = screen.getByLabelText("Task name");
    await user.clear(input);
    await user.type(input, "Water the ferns{Enter}");

    expect(await screen.findByText("Water the ferns")).toBeInTheDocument();
    expect(screen.queryByText("Water the plants")).not.toBeInTheDocument();
    await waitFor(() => expect(lastSyncedNames()).toContain("Water the ferns"));
  });

  it("opens with the caret at the end, nothing selected", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByText("Water the plants"));
    const input = screen.getByLabelText("Task name") as HTMLInputElement;

    // A full selection would have the first keystroke replace the name.
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);

    // So typing appends rather than overwrites.
    await user.type(input, "!{Enter}");
    expect(await screen.findByText("Water the plants!")).toBeInTheDocument();
  });

  it("leaves the name alone on Escape", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByText("Water the plants"));
    const input = screen.getByLabelText("Task name");
    await user.clear(input);
    await user.type(input, "Discarded{Escape}");

    expect(await screen.findByText("Water the plants")).toBeInTheDocument();
    expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
  });

  it("does not touch the pin of a task that already has a Microsoft id", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByText("Water the plants"));
    const input = screen.getByLabelText("Task name");
    await user.clear(input);
    await user.type(input, "Water the ferns{Enter}");

    await screen.findByText("Water the ferns");
    // The pin row is found by id and its name backfilled on the next read, so
    // a rename writes nothing here.
    expect(pinMock).not.toHaveBeenCalled();
  });
});
