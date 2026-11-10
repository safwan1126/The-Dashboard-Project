"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { syncTasksToMicrosoft, deleteTaskFromMicrosoft } from "@/lib/microsoft/syncTasks";
import { setTaskPin, importTaskPins } from "@/lib/data/taskPins";
import type { PinnedTask } from "@/lib/data/taskPinQueries";
import type { CalendarEvent, CalendarResult } from "@/lib/google/types";
import type { PomoSessionRow } from "@/lib/data/pomoTypes";
import {
  addHabit as addHabitAction,
  deleteHabit as deleteHabitAction,
  updateHabitFrequency as updateHabitFrequencyAction,
  toggleHabitToday as toggleHabitTodayAction,
  type HabitRow,
  type HabitCompletion,
} from "@/lib/data/habits";
import { addPomoSession } from "@/lib/data/pomoSessions";
import {
  addNote as addNoteAction,
  updateNoteBody as updateNoteBodyAction,
  deleteNote as deleteNoteAction,
  addNoteImages as addNoteImagesAction,
  removeNoteImage as removeNoteImageAction,
  type NoteRow,
} from "@/lib/data/notes";
import { createSingleFlight } from "@/lib/singleFlight";
import { POMO_COOKIE, serializePomoState, type PomoState, type PomoPhase } from "@/lib/pomodoro";
import { updateProfileName, changePassword, disconnectMicrosoft, disconnectGoogle } from "@/lib/settings/actions";
import { signOut } from "@/app/auth/actions";
import {
  CheckIcon, ChecklistIcon, ChevronDownIcon, ClockIcon, ExternalLinkIcon, FlameIcon, GearIcon,
  GoogleLogo, MicrosoftLogo, NoteIcon, PaperclipIcon, PauseIcon, PencilIcon, PinIcon, PinOffIcon,
  PlayIcon, PlusIcon, ResetIcon, SignOutIcon, SkipIcon, SpinnerIcon, SyncIcon, TrashIcon,
} from "./icons";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Reads go through Route Handlers rather than Server Actions. Server Actions
// are queued and execute sequentially, so fetching data through them makes the
// dashboard's on-mount requests wait on one another instead of running together.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

const LEGACY_PINNED_KEY = "pinnedTaskNames";

function readLegacyPinnedNames(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------- screens ---------- */
type Screen = "home" | "tasks" | "habits" | "tracker" | "notes" | "pomodoro" | "settings";

// The top-level destinations. "tracker" is a view inside Habits and "settings"
// lives in the account menu, so neither appears here.
const NAV: { key: Screen; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "tasks", label: "Tasks" },
  { key: "habits", label: "Habits" },
  { key: "pomodoro", label: "Focus" },
  { key: "notes", label: "Notes" },
];

/* ---------- theme options ---------- */
// Values are what globals.css keys on (html[data-accent] / html[data-voice]).
// The empty value is the default: no attribute at all.
const ACCENTS: { value: string; label: string; swatch?: string }[] = [
  { value: "", label: "Auto" },
  { value: "Sage", label: "Sage", swatch: "oklch(0.625 0.050 132)" },
  { value: "Indigo", label: "Indigo", swatch: "oklch(0.575 0.135 268)" },
  { value: "Clay", label: "Clay", swatch: "oklch(0.635 0.115 46)" },
  { value: "Plum", label: "Plum", swatch: "oklch(0.560 0.130 332)" },
];
const VOICES: { value: string; label: string }[] = [
  { value: "", label: "Serif" },
  { value: "Modern", label: "Modern" },
  { value: "Mono", label: "Mono" },
];

// A theme choice mirrored to an attribute on <html> and to localStorage. The
// inline script in the root layout has already applied the saved value before
// paint, so mounting only adopts what is there; the attribute and storage are
// written when the user actually picks something.
function useThemeAttr(name: "accent" | "voice") {
  const [value, setValue] = useState("");
  useEffect(() => {
    // Starts empty so server and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(document.documentElement.getAttribute(`data-${name}`) ?? "");
  }, [name]);
  function choose(next: string) {
    setValue(next);
    if (next) {
      document.documentElement.setAttribute(`data-${name}`, next);
      localStorage.setItem(name, next);
    } else {
      document.documentElement.removeAttribute(`data-${name}`);
      localStorage.removeItem(name);
    }
  }
  return [value, choose] as const;
}

/* ---------- task ---------- */
type Task = { msId?: string; name: string; time: string; done: boolean; starred: boolean };

// Tasks that come back from Microsoft To Do carry no time of day. They hold
// this placeholder, which the UI leaves blank rather than printing.
const NO_TIME = "--:--";

/* ---------- habits ---------- */
// frequency: days of week (0=Sun..6=Sat) the habit is scheduled on; empty = not scheduled on any day
type Habit = HabitRow;

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/* ---------- pomodoro history ---------- */
type PomoSession = { task: string | null; completedAt: number; duration: number };

const POMO_PALETTE = [
  "oklch(0.62 0.12 155)",
  "oklch(0.65 0.13 45)",
  "oklch(0.60 0.13 230)",
  "oklch(0.60 0.12 295)",
  "oklch(0.65 0.12 340)",
  "oklch(0.68 0.12 110)",
];

function pomoTaskColor(task: string | null, history: PomoSession[]): string {
  if (task === null) return "oklch(var(--tint) / 0.28)";
  const seen = [...new Set(history.filter(s => s.task !== null).map(s => s.task as string))];
  return POMO_PALETTE[Math.max(seen.indexOf(task), 0) % POMO_PALETTE.length];
}

function formatHHMM(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

function formatDurationMin(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

function dayLabel(dateKey: string): string {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- heatmap ---------- */
const SHADES = [
  "oklch(var(--tint) / 0.07)",
  "var(--sage-faint)",
  "var(--sage-soft)",
  "var(--sage)",
  "var(--sage-deep)",
];

const HEAT_WEEKS = 15;
const HEAT_DAYS = HEAT_WEEKS * 7; // one cell per day

// Total focus minutes in a day -> shade level (0-4). Fixed thresholds keyed to
// the timer's own presets: nothing / under 30m / 30-60m / 1-2h / 2h+.
function focusLevel(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

// The one empty state every card and screen uses: it keeps the layout still
// and says why the space is quiet.
function EmptyState({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export default function Dashboard({
  email,
  name: initialName,
  microsoftConnected,
  googleConnected,
  initialHabits,
  initialHabitCompletions,
  initialNotes,
  initialPomo,
}: {
  email: string;
  name: string;
  microsoftConnected: boolean;
  googleConnected: boolean;
  initialHabits: Habit[];
  initialHabitCompletions: HabitCompletion[];
  initialNotes: NoteRow[];
  initialPomo: PomoState;
}) {
  /* ---------- screen ---------- */
  // Views are switched with the History API (shallow routing) rather than
  // router.push. Pushing a new route would refetch this dynamic page's server
  // payload on every tab click; pushState updates the URL — and useSearchParams,
  // which stays in sync — without any server round-trip.
  const router = useRouter();
  const searchParams = useSearchParams();
  const screen = (searchParams.get("screen") ?? "home") as Screen;
  function setScreen(s: Screen) {
    const params = new URLSearchParams(searchParams.toString());
    if (s === "home") params.delete("screen");
    else params.set("screen", s);
    const qs = params.toString();
    window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
  }

  /* ---------- microsoft sync ---------- */
  const [syncing, startSync] = useTransition();
  const [syncStatus, setSyncStatus] = useState<"idle" | "success" | "error">("idle");
  const isFirstRender = useRef(true);
  // Set when the sync itself updates `tasks` (attaching Microsoft ids), so
  // that write doesn't bounce straight back into another sync.
  const skipNextSync = useRef(false);

  /* ---------- profile name ---------- */
  const [profileName, setProfileName] = useState(initialName);
  const [nameDraft, setNameDraft] = useState(initialName);
  const [nameSaved, setNameSaved] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  function saveProfileName() {
    const trimmed = nameDraft.trim();
    if (trimmed === profileName.trim()) return;
    setProfileName(trimmed);
    updateProfileName(trimmed).then((r) => {
      if (r.success) {
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 2000);
      }
    });
  }

  function savePassword() {
    const trimmed = passwordDraft.trim();
    if (trimmed.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    changePassword(trimmed).then((r) => {
      if (r.success) {
        setPasswordDraft("");
        setPasswordError("");
        setPasswordSaved(true);
        setTimeout(() => setPasswordSaved(false), 2000);
      } else {
        setPasswordError(r.error || "Could not update password");
      }
    });
  }

  function handleDisconnectMicrosoft() {
    disconnectMicrosoft().then((r) => { if (r.success) router.refresh(); });
  }

  function handleDisconnectGoogle() {
    disconnectGoogle().then((r) => { if (r.success) router.refresh(); });
  }

  /* ---------- dark mode ---------- */
  // Start at `false` to match server render (no hydration mismatch). The inline
  // script in the root layout has already applied the saved theme before paint;
  // on mount we adopt that value instead of re-writing it, so we never clobber
  // the attribute/localStorage or flash light→dark.
  const [darkMode, setDarkMode] = useState(false);
  const darkMounted = useRef(false);
  useEffect(() => {
    if (!darkMounted.current) {
      darkMounted.current = true;
      setDarkMode(document.documentElement.dataset.mood === "Charcoal");
      return;
    }
    document.documentElement.setAttribute("data-mood", darkMode ? "Charcoal" : "");
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

  /* ---------- glass mode ---------- */
  const [glass, setGlass] = useState(false);
  const glassMounted = useRef(false);
  useEffect(() => {
    if (!glassMounted.current) {
      glassMounted.current = true;
      setGlass(document.documentElement.dataset.glass === "on");
      return;
    }
    document.documentElement.setAttribute("data-glass", glass ? "on" : "");
    localStorage.setItem("glass", String(glass));
  }, [glass]);

  /* ---------- accent + voice ---------- */
  const [accent, setAccent] = useThemeAttr("accent");
  const [voice, setVoice] = useThemeAttr("voice");

  /* ---------- account menu ---------- */
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userMenuOpen]);
  // Up to two initials from the name, falling back to the email's first letter.
  const initials =
    (profileName.trim() || email)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Starts null so server and first client render match; real time is
    // filled in here, client-only, to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clockStr = now ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : "--:--";
  const secStr = now ? pad(now.getSeconds()) : "--";
  const dateStr = now
    ? `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`.toUpperCase()
    : "";

  /* ---------- tasks (shared between screens) ---------- */
  // Microsoft To Do has no "pinned" concept, so the starred flag can't
  // round-trip through the sync — it's kept in Supabase instead, which is what
  // makes a pin follow the user between browsers and devices. Reads come back
  // with /api/tasks; writes go through the Server Action below.
  function persistPin(task: { msId?: string; name: string }, starred: boolean) {
    setTaskPin(task.msId ?? null, task.name, starred).catch(console.error);
  }

  const [tasks, setTasks] = useState<Task[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const tasksAddInputRef = useRef<HTMLInputElement>(null);
  const [tasksAdding, setTasksAdding] = useState(false);
  const [tasksDraft, setTasksDraft] = useState("");
  // Index of the task whose name is being edited in place, or null.
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (tasksAdding) tasksAddInputRef.current?.focus();
  }, [tasksAdding]);

  useEffect(() => {
    if (editingTask === null) return;
    const input = editInputRef.current;
    if (!input) return;
    input.focus();
    // Caret at the end rather than the whole name selected: a rename is
    // usually a tweak, and a selection would have the first keystroke wipe it.
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [editingTask]);

  function toggleTask(i: number) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, done: !t.done } : t)));
  }

  function toggleStar(i: number) {
    setTasks((prev) => prev.map((t, idx) => {
      if (idx !== i) return t;
      const starred = !t.starred;
      persistPin(t, starred);
      return { ...t, starred };
    }));
  }

  function deleteTask(i: number) {
    const task = tasks[i];
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
    persistPin(task, false);
    if (microsoftConnected && task.msId) deleteTaskFromMicrosoft(task.msId);
  }

  function startRename(i: number) {
    setEditingTask(i);
    setRenameDraft(tasks[i].name);
  }

  function finishRename(commit: boolean) {
    if (editingTask === null) return;
    const i = editingTask;
    const task = tasks[i];
    const trimmed = renameDraft.trim();
    if (commit && trimmed && trimmed !== task.name) {
      // A pin row is looked up by Microsoft id first, so a renamed task that
      // already has one is healed by the backfill in resolveTaskPins. A task
      // typed in this session has no id yet and its pin is held by the old
      // name alone, so that row is moved across by hand.
      if (task.starred && !task.msId) {
        persistPin({ name: task.name }, false);
        persistPin({ name: trimmed }, true);
      }
      setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, name: trimmed } : t)));
    }
    setEditingTask(null);
    setRenameDraft("");
  }

  function finishAdd(commit: boolean) {
    const trimmed = draft.trim();
    if (commit && trimmed) {
      const d = new Date();
      persistPin({ name: trimmed }, true);
      setTasks((prev) => [...prev, { name: trimmed, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, done: false, starred: true }]);
    }
    setAdding(false);
    setDraft("");
  }

  function finishTasksAdd(commit: boolean) {
    const trimmed = tasksDraft.trim();
    if (commit && trimmed) {
      const d = new Date();
      setTasks((prev) => [...prev, { name: trimmed, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, done: false, starred: false }]);
    }
    setTasksAdding(false);
    setTasksDraft("");
  }

  // On mount, fetch tasks from Microsoft (pins resolved server-side)
  useEffect(() => {
    if (!microsoftConnected) return;
    // Pins used to live in localStorage; carry any left over into Supabase
    // before the fetch reads them, then drop the key for good.
    const legacy = readLegacyPinnedNames();
    const ready = legacy.length > 0
      ? importTaskPins(legacy)
          .then(() => localStorage.removeItem(LEGACY_PINNED_KEY))
          .catch(console.error)
      : Promise.resolve();

    ready
      .then(() => getJson<PinnedTask[]>("/api/tasks"))
      .then((remoteTasks) => {
        setTasks(remoteTasks.map((rt) => ({
          msId: rt.id,
          name: rt.name,
          time: NO_TIME,
          done: rt.done,
          starred: rt.pinned,
        })));
        isFirstRender.current = false;
      })
      .catch(console.error);
  }, []);

  // Auto-sync to Microsoft on every task change (skip the initial fetch)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (skipNextSync.current) { skipNextSync.current = false; return; }
    if (!microsoftConnected) return;
    startSync(async () => {
      const result = await syncTasksToMicrosoft(tasks);
      // The sync matches on the Microsoft id, so a task that was just typed
      // needs the id it was given attached before the next pass — otherwise it
      // would be matched by title, which a rename breaks.
      const ids = result.ids ?? [];
      if (ids.length > 0) {
        const msIdByName = new Map(ids.map((i) => [i.name, i.msId]));
        skipNextSync.current = true;
        setTasks((prev) => prev.map((t) => (t.msId ? t : { ...t, msId: msIdByName.get(t.name) })));
      }
      setSyncStatus(result.success ? "success" : "error");
      setTimeout(() => setSyncStatus("idle"), 3000);
    });
  }, [tasks]);

  const starredTasks = tasks.filter((t) => t.starred);
  const doneCount = starredTasks.filter((t) => t.done).length;
  const progressPct = starredTasks.length ? Math.round((doneCount / starredTasks.length) * 100) : 0;

  /* ---------- notes ---------- */
  const [notes, setNotes] = useState<NoteRow[]>(initialNotes);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(initialNotes[0]?.id ?? null);
  const [capture, setCapture] = useState("");
  const [captureUploading, setCaptureUploading] = useState(false);
  const [capturePreviews, setCapturePreviews] = useState<string[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const captureRef = useRef<HTMLTextAreaElement>(null);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  // Auto-grow the capture box so long thoughts wrap onto new lines instead of
  // scrolling sideways in a single-line field.
  useEffect(() => {
    const el = captureRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [capture]);

  function formatNoteTimestamp(iso: string): string {
    const d = new Date(iso);
    return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Creates a note from whatever's in the capture box (or blank) and makes it
  // active. Used when an attachment arrives before any text has been entered.
  async function ensureActiveNote(): Promise<string> {
    if (activeNoteId) return activeNoteId;
    const fd = new FormData();
    fd.append("body", capture.trim());
    const created = await addNoteAction(fd);
    setNotes((prev) => [created, ...prev]);
    setActiveNoteId(created.id);
    setCapture("");
    return created.id;
  }

  // Every Enter adds a new note rather than editing the last one — the
  // capture box is a pure "add" affordance, and history lives on the Notes
  // screen. The newly created note becomes active so a follow-up image
  // attach (paperclip) lands on it.
  function commitCapture() {
    const text = capture.trim();
    if (!text) return;
    setCapture("");
    const fd = new FormData();
    fd.append("body", text);
    addNoteAction(fd).then((created) => {
      setNotes((prev) => [created, ...prev]);
      setActiveNoteId(created.id);
    });
  }

  function onCaptureKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitCapture();
    }
  }

  async function attachImagesToNote(noteId: string, files: File[]): Promise<void> {
    const fd = new FormData();
    files.forEach((f) => fd.append("images", f));
    const images = await addNoteImagesAction(noteId, fd);
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, images: [...n.images, ...images] } : n)));
  }

  async function handleCaptureFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const previewUrls = files.map((f) => URL.createObjectURL(f));
    setCapturePreviews(previewUrls);
    setCaptureUploading(true);
    try {
      const id = await ensureActiveNote();
      await attachImagesToNote(id, files);
    } catch (err) {
      console.error("Failed to attach image", err);
    } finally {
      setCaptureUploading(false);
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
      setCapturePreviews([]);
    }
  }

  async function handleNewNoteCard() {
    const fd = new FormData();
    fd.append("body", "");
    const created = await addNoteAction(fd);
    setNotes((prev) => [created, ...prev]);
    setEditingNoteId(created.id);
    setEditDraft("");
  }

  function startEditingNote(n: NoteRow) {
    setEditingNoteId(n.id);
    setEditDraft(n.body);
  }

  function commitEditingNote() {
    if (!editingNoteId) return;
    const id = editingNoteId;
    const text = editDraft;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body: text, updatedAt: new Date().toISOString() } : n)));
    updateNoteBodyAction(id, text);
    setEditingNoteId(null);
  }

  function handleDeleteNote(id: string) {
    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);
    if (activeNoteId === id) setActiveNoteId(remaining[0]?.id ?? null);
    deleteNoteAction(id);
  }

  function handleRemoveNoteImage(noteId: string, imageId: string) {
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, images: n.images.filter((i) => i.id !== imageId) } : n)));
    removeNoteImageAction(imageId).catch((err) => console.error("Failed to remove image", err));
  }

  async function handleCardFiles(noteId: string, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    try {
      await attachImagesToNote(noteId, Array.from(fileList));
    } catch (err) {
      console.error("Failed to attach image", err);
    }
  }

  /* ---------- habits ---------- */
  const [habits, setHabits] = useState<Habit[]>(initialHabits);
  const [habitCompletions, setHabitCompletions] = useState<Set<string>>(
    () => new Set(initialHabitCompletions.map((c) => `${c.habitId}|${c.date}`))
  );
  async function toggleHabit(id: string) {
    const h = habits.find((h) => h.id === id);
    if (!h) return;
    const nowDone = !h.done;
    setHabits((prev) => prev.map((x) => (x.id === id ? { ...x, done: nowDone } : x)));
    setHabitCompletions((prev) => {
      const next = new Set(prev);
      const key = `${id}|${dateKey(new Date())}`;
      if (nowDone) next.add(key);
      else next.delete(key);
      return next;
    });
    const newStrk = await toggleHabitTodayAction(id, h.done);
    setHabits((prev) => prev.map((x) => (x.id === id ? { ...x, strk: newStrk } : x)));
  }
  function deleteHabit(id: string) {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    deleteHabitAction(id);
  }
  function toggleHabitFreqDay(id: string, day: number) {
    const h = habits.find((h) => h.id === id);
    if (!h) return;
    const has = h.frequency.includes(day);
    const newFreq = has ? h.frequency.filter((d) => d !== day) : [...h.frequency, day].sort();
    setHabits((prev) => prev.map((x) => (x.id === id ? { ...x, frequency: newFreq } : x)));
    updateHabitFrequencyAction(id, newFreq);
  }

  const todayDow = now ? now.getDay() : 0;
  const habitsToday = habits.filter((h) => h.frequency.includes(todayDow));
  const habitsDone = habitsToday.filter((h) => h.done).length;
  const habitsPct = habitsToday.length ? Math.round((habitsDone / habitsToday.length) * 100) : 0;

  /* ---------- habit tracker table (last 30 days) ---------- */
  const TRACKER_DAYS = 30;
  const trackerToday = now ? dateKey(now) : null;
  const trackerDays = useMemo(() => {
    const days: { key: string; dow: number; dayNum: number; monthLabel: string | null; isToday: boolean }[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (TRACKER_DAYS - 1));
    for (let i = 0; i < TRACKER_DAYS; i++) {
      days.push({
        key: dateKey(cursor),
        dow: cursor.getDay(),
        dayNum: cursor.getDate(),
        monthLabel: cursor.getDate() === 1 ? MONTHS[cursor.getMonth()].slice(0, 3) : null,
        isToday: i === TRACKER_DAYS - 1,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [trackerToday]);

  // The table runs oldest to newest, so on a narrow screen today starts off
  // the right-hand edge. Open the tracker scrolled to it.
  const trackerWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (screen !== "tracker") return;
    const wrap = trackerWrapRef.current;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  }, [screen]);

  /* ---------- habits screen: add habit ---------- */
  const [habitAdding, setHabitAdding] = useState(false);
  const [habitDraft, setHabitDraft] = useState("");
  const [habitDraftFreq, setHabitDraftFreq] = useState<number[]>([]);
  const habitAddInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (habitAdding) habitAddInputRef.current?.focus();
  }, [habitAdding]);

  function toggleDraftFreqDay(day: number) {
    setHabitDraftFreq((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function finishHabitAdd(commit: boolean) {
    const trimmed = habitDraft.trim();
    if (commit && trimmed) {
      const created = await addHabitAction(trimmed, habitDraftFreq);
      setHabits((prev) => [...prev, created]);
    }
    setHabitAdding(false);
    setHabitDraft("");
    setHabitDraftFreq([]);
  }

  /* ---------- calendar (Google, day view) ---------- */
  const [calDate, setCalDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null);
  const [calState, setCalState] = useState<"loading" | "ok" | "disconnected">(
    googleConnected ? "loading" : "disconnected"
  );
  const calCache = useRef(new Map<string, CalendarEvent[]>());
  // Collapses duplicate batch requests, keyed by the day list. Callers share
  // the pending promise rather than being turned away, so a second effect pass
  // — React StrictMode remounts every effect in development — still receives
  // the result instead of dropping it.
  const calInFlight = useRef(createSingleFlight<boolean>());
  // The viewer's actual IANA timezone, so event times are computed in the
  // browser's zone rather than whatever zone the server process happens to run in.
  const calTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  function isoOf(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function isoShift(iso: string, delta: number) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return isoOf(d);
  }
  const calDateISO = isoOf(calDate);

  /* ---------- "Up next" (Pomodoro screen): next Google Calendar event ---------- */
  type UpNextEvent = CalendarEvent & { dayOffset: 0 | 1 };
  const [upNextEvents, setUpNextEvents] = useState<UpNextEvent[] | null>(null);

  // "Today" only matters at day granularity. Deriving it from the per-second
  // clock tick would hand `daysToLoad` a new value every second and refire the
  // calendar fetch with it, so it is held as state and only moved at midnight.
  const [todayISO, setTodayISO] = useState(() => isoOf(new Date()));
  useEffect(() => {
    if (!now) return;
    const current = isoOf(now);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (current !== todayISO) setTodayISO(current);
  }, [now, todayISO]);

  // Everything the dashboard needs on screen: the visible day, its neighbours,
  // the whole visible week (for the strip and ‹ ›), and today + tomorrow (for
  // "Up next"). Fetched as one request — see loadDays.
  const daysToLoad = useMemo(() => {
    const mondayOffset = -((new Date(`${calDateISO}T00:00:00`).getDay() + 6) % 7);
    const wanted = new Set<string>([
      calDateISO,
      isoShift(calDateISO, -1),
      isoShift(calDateISO, 1),
      todayISO,
      isoShift(todayISO, 1),
    ]);
    for (let i = 0; i < 7; i++) wanted.add(isoShift(calDateISO, mondayOffset + i));
    return [...wanted].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calDateISO, todayISO]);

  // Fetch a batch of days into the cache in one round trip (deduped by batch).
  //
  // This goes through a Route Handler rather than a Server Action on purpose:
  // Server Actions are queued and execute sequentially, so the previous
  // day-at-a-time version had a dozen requests waiting on each other — which is
  // what made "Up next", queued last, take several seconds to appear.
  function loadDays(isos: string[]): Promise<boolean> {
    const key = isos.join(",");
    return calInFlight.current(key, async () => {
      try {
        const res = await fetch(
          `/api/calendar?days=${encodeURIComponent(key)}&tz=${encodeURIComponent(calTimeZone)}`
        );
        if (!res.ok) return false;
        const result: CalendarResult = await res.json();
        if (result.status === "disconnected") {
          setCalState("disconnected");
          return false;
        }
        for (const [iso, events] of Object.entries(result.days)) {
          calCache.current.set(iso, events);
        }
        return true;
      } catch {
        return false;
      }
    });
  }

  useEffect(() => {
    if (!googleConnected) return;
    let stale = false;

    const cached = calCache.current.get(calDateISO);
    if (cached) {
      // Instant render from cache, then refresh quietly in the background
      setCalEvents(cached);
      setCalState("ok");
    } else {
      setCalState("loading");
    }

    loadDays(daysToLoad).then((ok) => {
      if (stale || !ok) return;
      setCalEvents(calCache.current.get(calDateISO) ?? []);
      setCalState("ok");
      setUpNextEvents([
        ...(calCache.current.get(todayISO) ?? []).map((e) => ({ ...e, dayOffset: 0 as const })),
        ...(calCache.current.get(isoShift(todayISO, 1)) ?? []).map((e) => ({ ...e, dayOffset: 1 as const })),
      ]);
    });

    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnected, calDateISO, daysToLoad, todayISO]);

  function shiftCalDay(delta: number) {
    setCalDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta);
      return d;
    });
  }

  // Week strip: the 7 days (Mon–Sun) of the selected day's week
  const calWeek: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(calDate);
    d.setDate(d.getDate() - ((calDate.getDay() + 6) % 7) + i);
    return d;
  });
  const WEEK_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  const calIsToday = now ? calDate.toDateString() === now.toDateString() : true;
  const calLabel = calIsToday
    ? "Today"
    : `${DAYS[calDate.getDay()].slice(0, 3)} ${calDate.getDate()} ${MONTHS[calDate.getMonth()].slice(0, 3)}`;

  // Timeline window: 07:00–22:00, stretched if events fall outside it
  const CAL_PX_PER_MIN = 56 / 60;
  const timedEvents = (calEvents ?? []).filter((e) => !e.allDay);
  const allDayEvents = (calEvents ?? []).filter((e) => e.allDay);
  const calStartHour = Math.min(7, ...timedEvents.map((e) => Math.floor(e.startMin / 60)));
  const calEndHour = Math.max(22, ...timedEvents.map((e) => Math.ceil(e.endMin / 60)));

  /* ---------- heatmap: daily focus time from pomodoro sessions ---------- */
  // All-time focus minutes per local calendar day (keyed YYYY-MM-DD, matching
  // the pomodoro timeline's grouping). Paging is then pure client-side math.
  const [focusByDay, setFocusByDay] = useState<Map<string, number> | null>(null);
  const [heatPage, setHeatPage] = useState(0); // 0 = current 15 weeks, 1 = previous, ...
  useEffect(() => {
    getJson<PomoSessionRow[]>("/api/pomo-sessions?all=1")
      .then((rows) => {
        const byDay = new Map<string, number>();
        for (const r of rows) {
          const d = new Date(r.completedAt);
          const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          byDay.set(key, (byDay.get(key) ?? 0) + r.duration / 60); // duration is seconds
        }
        setFocusByDay(byDay);
      })
      .catch(console.error);
  }, []);

  // Build the visible 15-week window for the current page. The grid is
  // column-major (CSS: grid-auto-flow column, 7 rows): column = week, row =
  // weekday. The last column is `heatPage` windows before the current week, so
  // on page 0 today sits at its weekday and later-this-week cells stay empty.
  const { heat, heatTotalMin, heatRange, heatCanPrev } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastColWeekStart = new Date(today);
    lastColWeekStart.setDate(today.getDate() - today.getDay() - heatPage * HEAT_WEEKS * 7);

    const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dateOfCell = (i: number) => {
      const d = new Date(lastColWeekStart);
      d.setDate(lastColWeekStart.getDate() + (Math.floor(i / 7) - (HEAT_WEEKS - 1)) * 7 + (i % 7));
      return d;
    };

    if (!focusByDay) {
      return { heat: null as number[] | null, heatTotalMin: 0, heatRange: "", heatCanPrev: false };
    }

    const levels: number[] = [];
    let total = 0;
    for (let i = 0; i < HEAT_DAYS; i++) {
      const mins = focusByDay.get(keyOf(dateOfCell(i))) ?? 0;
      total += mins;
      levels.push(focusLevel(mins));
    }

    // Keys are zero-padded, so lexicographic order is chronological.
    const startKey = keyOf(dateOfCell(0));
    const canPrev = [...focusByDay.keys()].some((k) => k < startKey);

    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endDate = heatPage === 0 ? today : dateOfCell(HEAT_DAYS - 1);
    const range = `${fmt(dateOfCell(0))} – ${fmt(endDate)}`;

    return { heat: levels, heatTotalMin: Math.round(total), heatRange: range, heatCanPrev: canPrev };
  }, [focusByDay, heatPage]);

  /* ---------- pomodoro ---------- */
  const POMO_R = 160;
  const POMO_CIRC = 2 * Math.PI * POMO_R;
  const [pomoMinutes, setPomoMinutes] = useState(initialPomo.minutes);
  const [pomoBreakMinutes, setPomoBreakMinutes] = useState(initialPomo.breakMinutes);
  const [pomoPhase, setPomoPhase] = useState<PomoPhase>(initialPomo.phase);
  const [pomoSettingsOpen, setPomoSettingsOpen] = useState(false);
  const [pomoCustomInput, setPomoCustomInput] = useState("");
  const [pomoBreakCustomInput, setPomoBreakCustomInput] = useState("");
  const POMO_TOTAL = (pomoPhase === "break" ? pomoBreakMinutes : pomoMinutes) * 60;
  const [pomoRemain, setPomoRemain] = useState(initialPomo.remain);
  const [pomoRunning, setPomoRunning] = useState(initialPomo.running);
  const [pomoTaskName, setPomoTaskName] = useState<string | null>(initialPomo.taskName);
  const [pomoTaskChosen, setPomoTaskChosen] = useState(initialPomo.taskChosen);
  const [pomoPickerOpen, setPomoPickerOpen] = useState(false);
  const [pomoHistory, setPomoHistory] = useState<PomoSession[]>([]);
  const [pomoHistoryDays, setPomoHistoryDays] = useState(14);
  const [pomoHistoryLoadingMore, setPomoHistoryLoadingMore] = useState(false);
  const [pomoHistoryExhausted, setPomoHistoryExhausted] = useState(false);
  const pomoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pomoMounted = useRef(false);
  const pomoEndsAtRef = useRef<number | null>(null);
  const pomoRemainRef = useRef(pomoRemain);
  useEffect(() => { pomoRemainRef.current = pomoRemain; }, [pomoRemain]);

  const [pomoNotify, setPomoNotify] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("pomoNotify") === "true";
  });
  useEffect(() => {
    localStorage.setItem("pomoNotify", String(pomoNotify));
  }, [pomoNotify]);

  function togglePomoNotify() {
    setPomoNotify((prev) => {
      const next = !prev;
      if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
      return next;
    });
  }

  function notifyPomoComplete(finishedPhase: PomoPhase) {
    if (!pomoNotify) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(finishedPhase === "focus" ? "Focus session complete" : "Break complete", {
      body: finishedPhase === "focus" ? "Time for a break." : "Time to get back to it.",
    });
  }

  // Whether the next phase (break, or focus after a break) should start
  // running automatically, or land paused waiting for the user to hit Start.
  const [pomoAutoStart, setPomoAutoStart] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("pomoAutoStart");
    return v === null ? true : v === "true";
  });
  useEffect(() => {
    localStorage.setItem("pomoAutoStart", String(pomoAutoStart));
  }, [pomoAutoStart]);

  const pomoHistoryLenRef = useRef(0);
  useEffect(() => {
    getJson<PomoSessionRow[]>(`/api/pomo-sessions?days=${pomoHistoryDays}`)
      .then(rows => {
        const mapped = rows.map(r => ({ task: r.taskName, completedAt: r.completedAt, duration: r.duration }));
        // Asking for a wider window came back with the same rows we already had,
        // so there's nothing older left to page in.
        if (pomoHistoryDays > 14 && mapped.length === pomoHistoryLenRef.current) {
          setPomoHistoryExhausted(true);
        }
        pomoHistoryLenRef.current = mapped.length;
        setPomoHistory(mapped);
      })
      .catch(console.error)
      .finally(() => setPomoHistoryLoadingMore(false));
  }, [pomoHistoryDays]);

  function loadEarlierPomoSessions() {
    setPomoHistoryLoadingMore(true);
    setPomoHistoryDays((d) => d + 14);
  }

  function recordPomoSession(task: string | null, completedAt: number, duration: number) {
    setPomoHistory(h => [...h, { task, completedAt, duration }]);
    addPomoSession(task, completedAt, duration).catch(console.error);
  }

  useEffect(() => {
    if (pomoRunning) {
      // Anchor to an absolute end time and recompute the remaining seconds
      // from the clock on every tick, instead of just subtracting 1. Browsers
      // throttle setInterval in backgrounded tabs, so a naive decrement drifts
      // behind real elapsed time; this self-corrects regardless of how late a
      // tick fires.
      pomoEndsAtRef.current = Date.now() + pomoRemainRef.current * 1000;
      pomoTimerRef.current = setInterval(() => {
        const endsAt = pomoEndsAtRef.current;
        const left = endsAt ? Math.round((endsAt - Date.now()) / 1000) : 0;
        if (left > 0) {
          setPomoRemain(left);
          return;
        }
        if (pomoTimerRef.current) clearInterval(pomoTimerRef.current);
        notifyPomoComplete(pomoPhase);
        if (pomoPhase === "focus") {
          recordPomoSession(pomoTaskName, Date.now(), POMO_TOTAL);
          setPomoPhase("break");
          setPomoRemain(pomoBreakMinutes * 60);
        } else {
          setPomoPhase("focus");
          setPomoRemain(pomoMinutes * 60);
        }
        setPomoRunning(pomoAutoStart);
      }, 1000);
    } else if (pomoTimerRef.current) {
      clearInterval(pomoTimerRef.current);
    }
    return () => { if (pomoTimerRef.current) clearInterval(pomoTimerRef.current); };
  }, [pomoRunning, pomoPhase]);

  // Persist the timer to a cookie on every change so the *server* can seed the
  // initial render with it (see page.tsx / parsePomoState). Reading it server
  // side means a refresh paints the continued time immediately instead of
  // flashing the default 25:00 until the client hydrates. Skip the first run so
  // we don't rewrite the cookie that just seeded this mount.
  useEffect(() => {
    if (!pomoMounted.current) { pomoMounted.current = true; return; }
    const value = encodeURIComponent(serializePomoState({
      minutes: pomoMinutes,
      breakMinutes: pomoBreakMinutes,
      phase: pomoPhase,
      remain: pomoRemain,
      running: pomoRunning,
      taskName: pomoTaskName,
      taskChosen: pomoTaskChosen,
    }));
    document.cookie = `${POMO_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }, [pomoMinutes, pomoBreakMinutes, pomoPhase, pomoRemain, pomoRunning, pomoTaskName, pomoTaskChosen]);

  function completeCurrentPhase() {
    if (pomoTimerRef.current) clearInterval(pomoTimerRef.current);
    if (pomoPhase === "focus") {
      recordPomoSession(pomoTaskName, Date.now(), POMO_TOTAL - pomoRemain);
      setPomoPhase("break");
      setPomoRemain(pomoBreakMinutes * 60);
    } else {
      setPomoPhase("focus");
      setPomoRemain(pomoMinutes * 60);
    }
    setPomoRunning(pomoAutoStart);
  }

  function resetPomo() {
    setPomoRunning(false);
    setPomoPhase("focus");
    setPomoRemain(pomoMinutes * 60);
    setPomoTaskName(null);
    setPomoTaskChosen(false);
    setPomoPickerOpen(false);
  }

  function applyPomoMinutes(mins: number) {
    setPomoMinutes(mins);
    setPomoPhase("focus");
    setPomoRemain(mins * 60);
    setPomoRunning(false);
    setPomoTaskName(null);
    setPomoTaskChosen(false);
    setPomoSettingsOpen(false);
    setPomoCustomInput("");
  }

  function applyPomoBreakMinutes(mins: number) {
    setPomoBreakMinutes(mins);
    if (pomoPhase === "break") {
      setPomoRemain(mins * 60);
      setPomoRunning(false);
    }
    setPomoBreakCustomInput("");
  }

  const pomoTime = `${pad(Math.floor(pomoRemain / 60))}:${pad(pomoRemain % 60)}`;
  const pomoOffset = (POMO_CIRC * (pomoRemain / POMO_TOTAL)).toFixed(1);
  const POMO_SIZE = POMO_R * 2 + 20;
  const POMO_CX = POMO_SIZE / 2;

  /* ---------- "Up next" widget: nearest upcoming (or in-progress) event ---------- */
  const nowTotalSec = now ? now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() : 0;
  const nextUpEvent = (() => {
    if (!upNextEvents || !now) return null;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return upNextEvents
      .filter((e) => !e.allDay)
      .filter((e) => e.dayOffset === 1 || e.endMin > nowMin)
      .sort((a, b) => (a.dayOffset - b.dayOffset) || (a.startMin - b.startMin))[0] ?? null;
  })();
  const nextUpStartSec = nextUpEvent ? nextUpEvent.dayOffset * 86400 + nextUpEvent.startMin * 60 : 0;
  const nextUpEndSec = nextUpEvent ? nextUpEvent.dayOffset * 86400 + nextUpEvent.endMin * 60 : 0;
  const nextUpInProgress = nextUpEvent ? nowTotalSec >= nextUpStartSec && nowTotalSec < nextUpEndSec : false;
  const nextUpCountdownMin = nextUpEvent
    ? Math.ceil(((nextUpInProgress ? nextUpEndSec : nextUpStartSec) - nowTotalSec) / 60)
    : 0;
  // The one card that carries the shadow: Next up while there is still an
  // event left today, otherwise the calendar.
  const nextUpLive = !!nextUpEvent && nextUpEvent.dayOffset === 0;
  const nextUpProgressPct = nextUpInProgress
    ? Math.min(100, Math.max(0, ((nowTotalSec - nextUpStartSec) / (nextUpEndSec - nextUpStartSec)) * 100))
    : 0;

  return (
    <div className="stage">
      {/* ===== TOP BAR ===== */}
      <header className="topbar">
        <div className="brand">
          <div className="name">LifeOS</div>
          <div className="sub">
            <span>operating</span>
            <span>system</span>
          </div>
        </div>
        <nav className="screen-nav" aria-label="Screens">
          {NAV.map(({ key, label }) => {
            // The tracker is a view of Habits, so Habits stays lit for both.
            const active = screen === key || (key === "habits" && screen === "tracker");
            return (
              <button
                key={key}
                className={"screen-nav-btn" + (active ? " active" : "")}
                aria-current={active ? "page" : undefined}
                onClick={() => setScreen(key)}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div className="topbar-user" ref={userMenuRef}>
          <button
            className={"avatar-btn" + (screen === "settings" ? " active" : "")}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((o) => !o)}
          >
            {initials}
          </button>
          {userMenuOpen && (
            <div className="user-menu" role="menu">
              <div className="user-menu-head">
                <div className="user-menu-name">{profileName.trim() || "Your account"}</div>
                <div className="user-menu-email">{email}</div>
              </div>
              <button
                className="user-menu-item"
                role="menuitem"
                onClick={() => { setUserMenuOpen(false); setScreen("settings"); }}
              >
                <GearIcon />
                Settings
              </button>
              <form action={signOut}>
                <button className="user-menu-item" role="menuitem" type="submit">
                  <SignOutIcon />
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      {screen === "home" ? (
        <div className="grid">
          {/* ===== LEFT ===== */}
          <div className="col col-left">
            <div className="card stack-todo">
              <div className="card-head">
                <div className="card-heading">
                  <div className="card-eyebrow">To-do</div>
                </div>
                {microsoftConnected && starredTasks.length > 0 && (
                  <div className="card-meta">
                    <b className="num">{doneCount}</b> of <span className="num">{starredTasks.length}</span> done
                  </div>
                )}
              </div>
              {microsoftConnected ? (
                <>
                  {starredTasks.length > 0 ? (
                    <>
                      <div className="todo-prog">
                        <div className="bar"><i style={{ width: `${progressPct}%` }} /></div>
                      </div>
                      <div className="todo-list">
                        {starredTasks.map((t, i) => (
                          <div
                            key={i}
                            className={"todo-item" + (t.done ? " done" : "")}
                            onClick={() => toggleTask(tasks.indexOf(t))}
                          >
                            <span className="check"><CheckIcon /></span>
                            <span className="name">{t.name}</span>
                            {t.time !== NO_TIME && <span className="time">{t.time}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyState icon={<PinIcon />}>
                      Nothing pinned. Add a task below, or pin one from{" "}
                      <button className="link-btn" onClick={() => setScreen("tasks")}>Tasks</button>.
                    </EmptyState>
                  )}
                  {adding ? (
                    <input
                      ref={addInputRef}
                      className="add-input"
                      placeholder="Task name, then Enter…"
                      aria-label="New task"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishAdd(true);
                        if (e.key === "Escape") finishAdd(false);
                      }}
                      onBlur={() => finishAdd(true)}
                    />
                  ) : (
                    <button className="add-task" onClick={() => setAdding(true)}>
                      <PlusIcon />
                      Add task
                    </button>
                  )}
                </>
              ) : (
                <div className="todo-connect-prompt">
                  <p className="todo-connect-msg">Connect Microsoft To Do to manage your tasks — they&apos;ll sync across all your devices.</p>
                  <a href="/auth/microsoft" className="connect-btn">
                    <MicrosoftLogo />
                    Connect Microsoft To Do
                  </a>
                </div>
              )}
            </div>

            <div className="card stack-note">
              <div className="card-head">
                <div className="card-heading">
                  <div className="card-eyebrow rose">Quick note</div>
                </div>
                {activeNote && <div className="card-meta num">{formatNoteTimestamp(activeNote.updatedAt)}</div>}
              </div>
              {activeNote?.body ? (
                <p className="note-body">{activeNote.body}</p>
              ) : (
                <p className="note-body note-empty">No notes yet — capture one below.</p>
              )}
              {(activeNote?.images.length || capturePreviews.length) ? (
                <div className="note-card-images">
                  {activeNote?.images.map((img) => (
                    <div className="note-thumb-wrap" key={img.id}>
                      <img src={img.url} alt="" className="note-thumb" />
                    </div>
                  ))}
                  {capturePreviews.map((url) => (
                    <div className="note-thumb-wrap" key={url}>
                      <img src={url} alt="" className="note-thumb" />
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="note-divider" />
              <div className="capture">
                <textarea
                  ref={captureRef}
                  rows={1}
                  placeholder="Capture a thought…"
                  aria-label="Capture a thought"
                  value={capture}
                  onChange={(e) => setCapture(e.target.value)}
                  onKeyDown={onCaptureKeyDown}
                />
                <label className="capture-attach-btn" title="Attach image" aria-disabled={captureUploading}>
                  <PaperclipIcon />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    disabled={captureUploading}
                    onChange={(e) => { handleCaptureFiles(e.target.files); e.target.value = ""; }}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* ===== CENTER ===== */}
          <div className="col col-center">
            <div className="clockblock stack-clock">
              <div className="bigclock">{clockStr}<span className="sec">:{secStr}</span></div>
              <div className="bigdate">{dateStr}</div>
            </div>

            {/* Stays mounted whenever the calendar is connected, so the cards
                below it don't jump when the day's last event passes. */}
            {googleConnected && calState !== "disconnected" && (
              <div className={"card stack-next-up" + (nextUpLive ? " primary" : "")}>
                {nextUpEvent ? (
                  <>
                    <div className="card-head">
                      <div className="card-heading">
                        <div className="card-eyebrow">
                          Next up ·{" "}
                          <span className="num">
                            {nextUpInProgress
                              ? `now, ends in ${formatDurationMin(nextUpCountdownMin)}`
                              : `starts in ${formatDurationMin(nextUpCountdownMin)}`}
                          </span>
                        </div>
                        <div className="card-title next-up-title">{nextUpEvent.title}</div>
                      </div>
                      <div className="card-meta num">
                        {nextUpEvent.dayOffset === 1 ? "Tomorrow · " : ""}{nextUpEvent.start} → {nextUpEvent.end}
                      </div>
                    </div>
                    <div className="next-up-track">
                      <div className="next-up-track-row">
                        <span className="next-up-track-label num">Now {clockStr}</span>
                        <span className="next-up-track-label num">
                          {formatDurationMin(nextUpEvent.endMin - nextUpEvent.startMin)} · ends {nextUpEvent.end}
                        </span>
                      </div>
                      <div className="bar next-up-track-bar"><i style={{ width: `${nextUpProgressPct}%` }} /></div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="card-head">
                      <div className="card-heading">
                        <div className="card-eyebrow">Next up</div>
                      </div>
                    </div>
                    <EmptyState icon={<ClockIcon />}>
                      {upNextEvents === null ? "Checking your calendar…" : "Nothing scheduled today or tomorrow."}
                    </EmptyState>
                  </>
                )}
              </div>
            )}

            <div className={"card stack-calendar" + (nextUpLive ? "" : " primary")}>
              <div className="card-head">
                <div className="card-heading">
                  <div className="card-eyebrow">Calendar</div>
                  <div className="card-title">{calLabel}</div>
                </div>
                <div className="cal-nav">
                  <a
                    href="https://calendar.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cal-open-btn"
                    title="Open Google Calendar"
                    aria-label="Open Google Calendar"
                  >
                    <ExternalLinkIcon />
                  </a>
                  {!calIsToday && (
                    <button
                      className="cal-today-btn"
                      onClick={() => {
                        const d = new Date();
                        d.setHours(0, 0, 0, 0);
                        setCalDate(d);
                      }}
                    >
                      Today
                    </button>
                  )}
                  <button aria-label="Previous day" onClick={() => shiftCalDay(-1)}>‹</button>
                  <button aria-label="Next day" onClick={() => shiftCalDay(1)}>›</button>
                </div>
              </div>
              {calState === "disconnected" ? (
                <a href="/auth/google" className="connect-btn">
                  <GoogleLogo />
                  {googleConnected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
                </a>
              ) : (
                <>
                  <div className="cal-week">
                    {calWeek.map((d, i) => {
                      const selected = d.toDateString() === calDate.toDateString();
                      const isToday = now ? d.toDateString() === now.toDateString() : false;
                      return (
                        <button
                          key={i}
                          className={"cal-week-day" + (selected ? " selected" : "") + (isToday ? " is-today" : "")}
                          aria-pressed={selected}
                          onClick={() => {
                            const next = new Date(d);
                            next.setHours(0, 0, 0, 0);
                            setCalDate(next);
                          }}
                        >
                          <span className="cal-week-wd">{WEEK_LABELS[i]}</span>
                          <span className="cal-week-num num">{pad(d.getDate())}</span>
                        </button>
                      );
                    })}
                  </div>
                  {allDayEvents.length > 0 && (
                    <div className="cal-allday">
                      {allDayEvents.map((ev) => (
                        <span key={ev.id} className="cal-allday-chip">{ev.title}</span>
                      ))}
                    </div>
                  )}
                  <div className={"cal-timeline" + (calState === "loading" ? " loading" : "")}>
                    <div className="cal-timeline-inner">
                    {Array.from({ length: calEndHour - calStartHour + 1 }, (_, i) => {
                      const h = calStartHour + i;
                      return (
                        <div key={h} className="cal-hour" style={{ top: `${(h - calStartHour) * 60 * CAL_PX_PER_MIN}px` }}>
                          <span className="cal-hour-label num">{pad(h)}:00</span>
                          <span className="cal-hour-line" />
                        </div>
                      );
                    })}
                    {calIsToday && now && (() => {
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      if (nowMin < calStartHour * 60 || nowMin > calEndHour * 60) return null;
                      return (
                        <div className="cal-now" style={{ top: `${(nowMin - calStartHour * 60) * CAL_PX_PER_MIN}px` }}>
                          <span className="cal-now-dot" />
                        </div>
                      );
                    })()}
                    {timedEvents.map((ev) => {
                      const top = (ev.startMin - calStartHour * 60) * CAL_PX_PER_MIN;
                      const height = Math.max((ev.endMin - ev.startMin) * CAL_PX_PER_MIN, 24);
                      return (
                        <div key={ev.id} className="cal-block" style={{ top: `${top}px`, height: `${height}px` }} title={`${ev.title} · ${ev.start} – ${ev.end}`}>
                          <span className="cal-block-title">{ev.title}</span>
                          {height > 38 && <span className="cal-block-time num">{ev.start} – {ev.end}</span>}
                        </div>
                      );
                    })}
                    <div style={{ height: `${(calEndHour - calStartHour) * 60 * CAL_PX_PER_MIN + 14}px` }} />
                    </div>
                  </div>
                  {calState === "ok" && timedEvents.length === 0 && allDayEvents.length === 0 && (
                    <p className="cal-empty">No events — clear runway.</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ===== RIGHT ===== */}
          <div className="col col-right">
            <div className="card stack-habits">
              <div className="card-head">
                <div className="card-heading">
                  <div className="card-eyebrow">Habits</div>
                </div>
                {now && habitsToday.length > 0 && (
                  <div className="card-meta">
                    <b className="num">{habitsDone}</b> of <span className="num">{habitsToday.length}</span> · <span className="num">{habitsPct}%</span>
                  </div>
                )}
              </div>

              {/* Which habits are due depends on the weekday, which is only
                  known once the clock has mounted — so nothing is drawn (and
                  no empty state flashes) before then. */}
              {!now ? null : habitsToday.length > 0 ? (
                <>
                  <div className="habits-score">
                    <div className="habits-score-badge num">{habitsDone}</div>
                    <div className="habits-score-mid">
                      <div className="habits-score-label">Daily score · resets 00:00</div>
                      <div className="habits-score-msg">
                        {habitsDone === 0 ? "Start with one." : `${habitsDone} done — keep going.`}
                      </div>
                    </div>
                    <div className="habits-score-bar">
                      <i style={{ width: `${habitsPct}%` }} />
                    </div>
                  </div>

                  <div className="habits-grid">
                    {habitsToday.map((hb) => (
                      <div
                        key={hb.id}
                        className={"habit-card" + (hb.done ? " done" : "")}
                        onClick={() => toggleHabit(hb.id)}
                      >
                        <span className="habit-check" />
                        <div className="habit-info">
                          <div className="habit-name">{hb.name}</div>
                        </div>
                        <div className="habit-strk">
                          <FlameIcon />
                          {hb.strk}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState icon={<FlameIcon />}>
                  {habits.length === 0 ? (
                    <>
                      No habits yet.{" "}
                      <button className="link-btn" onClick={() => setScreen("habits")}>Add one</button>
                    </>
                  ) : (
                    <>
                      Nothing scheduled for {DAYS[todayDow]}.{" "}
                      <button className="link-btn" onClick={() => setScreen("habits")}>Edit schedule</button>
                    </>
                  )}
                </EmptyState>
              )}
            </div>

            <div className="card stack-activity">
              <div className="card-head">
                <div className="card-heading">
                  <div className="card-eyebrow">Activity</div>
                </div>
                <div className="heat-nav">
                  <span className="card-meta"><b className="num">{Math.round(heatTotalMin / 60)}</b> hrs</span>
                  <button type="button" aria-label="Earlier weeks" disabled={!heatCanPrev} onClick={() => setHeatPage((p) => p + 1)}>‹</button>
                  <button type="button" aria-label="Later weeks" disabled={heatPage === 0} onClick={() => setHeatPage((p) => Math.max(0, p - 1))}>›</button>
                </div>
              </div>
              <div className="heat">
                {(heat ?? Array.from({ length: HEAT_DAYS }, () => 0)).map((lvl, i) => (
                  <div key={i} className="hc" style={{ background: SHADES[lvl] }} />
                ))}
              </div>
              <div className="heat-legend">
                <span>{heatRange || "15 Weeks"}</span>
                <div className="scale">
                  <span>Less</span>
                  {SHADES.map((s, i) => (
                    <i key={i} style={{ background: s }} />
                  ))}
                  <span>More</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : screen === "tasks" ? (
        /* ===== TASKS SCREEN ===== */
        <div className="page">
          {!microsoftConnected ? (
            <div className="tasks-connect-wall">
              <div className="tasks-connect-inner">
                <ChecklistIcon />
                <h2 className="tasks-connect-title">Tasks require Microsoft To Do</h2>
                <p className="tasks-connect-msg">Your tasks are stored in Microsoft To Do and sync across all your devices. Connect your account to get started.</p>
                <a href="/auth/microsoft" className="connect-btn">
                  <MicrosoftLogo />
                  Connect Microsoft To Do
                </a>
              </div>
            </div>
          ) : (
          <>
          <div className="page-header">
            <div>
              <h1 className="page-title">All Tasks</h1>
              <p className="page-sub">{tasks.length} tasks · {tasks.filter(t => t.starred).length} pinned to To-Do</p>
            </div>
            <div className="page-actions">
              <span className="connect-btn connected">
                <MicrosoftLogo />
                Microsoft To Do connected
              </span>
              <span className={"sync-chip" + (syncStatus === "success" ? " success" : syncStatus === "error" ? " error" : "")}>
                <SyncIcon className={syncing ? "spin" : ""} />
                {syncing ? "Syncing…" : syncStatus === "success" ? "Synced!" : syncStatus === "error" ? "Sync failed" : "Auto-sync on"}
              </span>
              <button className={"add-task tasks-add-btn" + (tasksAdding ? " cancelling" : "")} onClick={() => { setTasksAdding((v) => !v); setTasksDraft(""); }}>
                {tasksAdding ? (
                  "Cancel"
                ) : (
                  <>
                    <PlusIcon />
                    New task
                  </>
                )}
              </button>
            </div>
          </div>

          {(() => {
            const pinned = tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.starred);
            const other = tasks.map((t, i) => ({ t, i })).filter(({ t }) => !t.starred);
            const renderRow = ({ t, i }: { t: Task; i: number }, isPinned: boolean) => (
              <div key={i} className={"tasks-row" + (t.done ? " done" : "") + (isPinned ? " is-pinned" : "")}>
                <span className="tasks-check" onClick={() => toggleTask(i)}>
                  <span className="check">
                    <CheckIcon />
                  </span>
                </span>
                {editingTask === i ? (
                  <input
                    ref={editInputRef}
                    className="add-input tasks-name-input"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename(true);
                      if (e.key === "Escape") finishRename(false);
                    }}
                    onBlur={() => finishRename(true)}
                    aria-label="Task name"
                  />
                ) : (
                  <span className="tasks-name" onClick={() => startRename(i)} title="Click to rename">{t.name}</span>
                )}
                <span className="tasks-time num">{t.time !== NO_TIME ? t.time : ""}</span>
                {isPinned ? (
                  <button
                    className="tasks-pin tasks-unpin"
                    onClick={() => toggleStar(i)}
                    title="Unpin from To-Do list"
                  >
                    <PinOffIcon />
                  </button>
                ) : (
                  <button
                    className="tasks-pin"
                    onClick={() => toggleStar(i)}
                    title="Pin to To-Do list"
                  >
                    <PinIcon />
                  </button>
                )}
                <button className="tasks-edit" onClick={() => startRename(i)} aria-label="Rename task">
                  <PencilIcon />
                </button>
                <button className="tasks-delete" onClick={() => deleteTask(i)} aria-label="Delete task">
                  <TrashIcon />
                </button>
              </div>
            );
            return (
              <>
                {pinned.length > 0 && (
                  <>
                    <p className="tasks-section-label">Pinned to To-Do</p>
                    <div className="tasks-list-full">
                      {pinned.map((item) => renderRow(item, true))}
                    </div>
                  </>
                )}
                {other.length > 0 && (
                  <>
                    <p className="tasks-section-label">Other</p>
                    <div className="tasks-list-full">
                      {tasksAdding && (
                        <div className="tasks-row tasks-row-adding">
                          <input
                            ref={tasksAddInputRef}
                            className="add-input"
                            placeholder="Task name, then Enter…"
                            value={tasksDraft}
                            onChange={(e) => setTasksDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") finishTasksAdd(true);
                              if (e.key === "Escape") finishTasksAdd(false);
                            }}
                          />
                        </div>
                      )}
                      {other.map((item) => renderRow(item, false))}
                    </div>
                  </>
                )}
                {other.length === 0 && tasksAdding && (
                  <>
                    <p className="tasks-section-label">Other</p>
                    <div className="tasks-list-full">
                      <div className="tasks-row tasks-row-adding">
                        <input
                          ref={tasksAddInputRef}
                          className="add-input"
                          placeholder="Task name, then Enter…"
                          value={tasksDraft}
                          onChange={(e) => setTasksDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishTasksAdd(true);
                            if (e.key === "Escape") finishTasksAdd(false);
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}
          </>
          )}
        </div>
      ) : null}

      {(screen === "habits" || screen === "tracker") && (
        /* ===== HABITS SCREEN: list and 30-day tracker are two views of it ===== */
        <div className="page wide">
          <div className="page-header">
            <div>
              <h1 className="page-title">Habits</h1>
              <p className="page-sub">
                {screen === "habits"
                  ? `${habits.length} habits · ${habitsToday.length} scheduled today`
                  : `${habits.length} habits · last ${TRACKER_DAYS} days`}
              </p>
            </div>
            <div className="page-actions">
              <div className="subtabs" role="tablist" aria-label="Habits view">
                <button
                  role="tab"
                  aria-selected={screen === "habits"}
                  className={"subtab" + (screen === "habits" ? " active" : "")}
                  onClick={() => setScreen("habits")}
                >
                  List
                </button>
                <button
                  role="tab"
                  aria-selected={screen === "tracker"}
                  className={"subtab" + (screen === "tracker" ? " active" : "")}
                  onClick={() => setScreen("tracker")}
                >
                  Tracker
                </button>
              </div>
              {/* Shown in both views so the view switch beside it never moves. */}
              <button
                className="add-task tasks-add-btn"
                onClick={() => { setScreen("habits"); setHabitAdding(true); }}
              >
                <PlusIcon />
                New habit
              </button>
            </div>
          </div>

          {screen === "habits" ? (
            <div className="tasks-list-full">
              {habitAdding && (
                <div className="habit-row habit-row-adding">
                  <input
                    ref={habitAddInputRef}
                    className="add-input"
                    placeholder="Habit name, then Enter…"
                    aria-label="Habit name"
                    value={habitDraft}
                    onChange={(e) => setHabitDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishHabitAdd(true);
                      if (e.key === "Escape") finishHabitAdd(false);
                    }}
                  />
                  <div className="freq-picker">
                    {DAY_LETTERS.map((l, d) => (
                      <button
                        key={d}
                        type="button"
                        className={"freq-day" + (habitDraftFreq.includes(d) ? " active" : "")}
                        aria-label={DAYS[d]}
                        aria-pressed={habitDraftFreq.includes(d)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggleDraftFreqDay(d)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <button className="add-task" onMouseDown={(e) => e.preventDefault()} onClick={() => finishHabitAdd(true)}>
                    Add
                  </button>
                  <button className="habit-cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => finishHabitAdd(false)}>
                    Cancel
                  </button>
                </div>
              )}
              {habits.length === 0 && !habitAdding && (
                <EmptyState icon={<FlameIcon />}>
                  No habits yet. Add your first with New habit, then pick the days it runs on.
                </EmptyState>
              )}
              {habits.map((hb) => (
                <div key={hb.id} className="habit-row">
                  <div className="habit-row-info">
                    <div className="tasks-name">{hb.name}</div>
                  </div>
                  <div className="freq-picker">
                    {DAY_LETTERS.map((l, d) => (
                      <button
                        key={d}
                        type="button"
                        className={"freq-day" + (hb.frequency.includes(d) ? " active" : "")}
                        aria-label={DAYS[d]}
                        aria-pressed={hb.frequency.includes(d)}
                        onClick={() => toggleHabitFreqDay(hb.id, d)}
                        title={hb.frequency.length === 0 ? "Not scheduled on any day" : undefined}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="habit-strk">
                    <FlameIcon />
                    {hb.strk}
                  </div>
                  <button className="tasks-delete" onClick={() => deleteHabit(hb.id)} aria-label="Delete habit">
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="tracker-table-wrap" ref={trackerWrapRef}>
              <table className="tracker-table">
                <thead>
                  <tr>
                    <th className="tracker-name-col" />
                    {trackerDays.map((d) => (
                      <th key={d.key} className={"tracker-th" + (d.isToday ? " today" : "")}>
                        {DAY_LETTERS[d.dow]}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="tracker-name-col">Habit</th>
                    {trackerDays.map((d) => (
                      <th key={d.key} className={"tracker-th tracker-th-num" + (d.isToday ? " today" : "")}>
                        {d.dayNum}
                        {d.monthLabel && <span className="tracker-month-tag">{d.monthLabel}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {habits.map((hb) => (
                    <tr key={hb.id}>
                      <td className="tracker-name-col">{hb.name}</td>
                      {trackerDays.map((d) => {
                        const before = d.key < hb.createdAt;
                        const done = habitCompletions.has(`${hb.id}|${d.key}`);
                        const clickable = d.isToday && !before;
                        return (
                          <td
                            key={d.key}
                            className={
                              "tracker-cell" +
                              (before ? " before" : "") +
                              (done ? " done" : "") +
                              (d.isToday ? " today" : "") +
                              (clickable ? " clickable" : "")
                            }
                            onClick={clickable ? () => toggleHabit(hb.id) : undefined}
                            title={before ? "Not tracked yet" : d.key}
                          >
                            {!before && <span className="tracker-dot" />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {habits.length === 0 && (
                    <tr>
                      <td className="tracker-empty" colSpan={TRACKER_DAYS + 1}>
                        No habits yet. Add one from the List view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {screen === "notes" && (
        /* ===== NOTES SCREEN ===== */
        <div className="page wide">
          <div className="page-header">
            <div>
              <h1 className="page-title">Notes</h1>
              <p className="page-sub">{notes.length} note{notes.length === 1 ? "" : "s"}</p>
            </div>
            <button className="add-task tasks-add-btn" onClick={handleNewNoteCard}>
              <PlusIcon />
              New note
            </button>
          </div>

          {notes.length === 0 ? (
            <EmptyState icon={<NoteIcon />}>
              No notes yet. Capture one from the home screen, or start one here with New note.
            </EmptyState>
          ) : (
            <div className="notes-grid">
              {notes.map((n) => (
                <div key={n.id} className="card note-card">
                  <div className="note-card-actions">
                    <label className="capture-attach-btn" title="Add images">
                      <PaperclipIcon />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => { handleCardFiles(n.id, e.target.files); e.target.value = ""; }}
                      />
                    </label>
                    <button className="tasks-delete" onClick={() => handleDeleteNote(n.id)} aria-label="Delete note">
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="note-card-date">{formatNoteTimestamp(n.updatedAt)}</div>
                  {editingNoteId === n.id ? (
                    <textarea
                      className="note-edit-textarea"
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={commitEditingNote}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEditingNote(); }
                        if (e.key === "Escape") setEditingNoteId(null);
                      }}
                    />
                  ) : (
                    <p className="note-body" onClick={() => startEditingNote(n)}>
                      {n.body || <span className="note-empty">Click to add text…</span>}
                    </p>
                  )}
                  {n.images.length > 0 && (
                    <div className="note-card-images">
                      {n.images.map((img) => (
                        <div className="note-thumb-wrap" key={img.id}>
                          <img src={img.url} alt="" className="note-thumb" />
                          <button
                            type="button"
                            className="note-thumb-remove"
                            onClick={() => handleRemoveNoteImage(n.id, img.id)}
                            aria-label="Remove image"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {screen === "pomodoro" && (
        <>
          {pomoPickerOpen && !pomoRunning && (
            <div className="pomo-modal-backdrop" onClick={() => setPomoPickerOpen(false)}>
              <div className="pomo-modal" onClick={(e) => e.stopPropagation()}>
                <div className="pomo-modal-title">Focus on a task</div>
                <div className="pomo-modal-list">
                  <button
                    className={"pomo-picker-item" + (pomoTaskChosen && pomoTaskName === null ? " active" : "")}
                    onClick={() => { setPomoTaskName(null); setPomoTaskChosen(true); setPomoPickerOpen(false); }}
                  >
                    No task
                  </button>
                  {tasks
                    .filter((t) => !t.done)
                    .sort((a, b) => Number(b.starred) - Number(a.starred))
                    .map((t) => (
                    <button
                      key={t.name}
                      className={"pomo-picker-item" + (pomoTaskName === t.name ? " active" : "")}
                      onClick={() => { setPomoTaskName(t.name); setPomoTaskChosen(true); setPomoPickerOpen(false); }}
                    >
                      <span className="pomo-picker-name">{t.name}</span>
                      {t.starred && (
                        <span className="pomo-picker-pin" title="Pinned to To-Do"><PinIcon /></span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="pomo-page">
            <div className="pomo-page-body">
              <div className="pomo-page-ring">
                <svg width={POMO_SIZE} height={POMO_SIZE} viewBox={`0 0 ${POMO_SIZE} ${POMO_SIZE}`} aria-hidden="true">
                  <circle cx={POMO_CX} cy={POMO_CX} r={POMO_R} fill="none" stroke="oklch(var(--tint) / 0.08)" strokeWidth="4" />
                  <circle
                    cx={POMO_CX} cy={POMO_CX} r={POMO_R} fill="none" stroke="var(--sage)" strokeWidth="4"
                    strokeLinecap="round" strokeDasharray={POMO_CIRC} strokeDashoffset={pomoOffset}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                  />
                </svg>
                <div className="pomo-page-center">
                  <div className="pomo-page-mode">{pomoPhase === "break" ? "Break" : "Focus"}</div>
                  <div className="pomo-page-time num">{pomoTime}</div>
                  {pomoPhase === "focus" && pomoTaskChosen && pomoTaskName && (
                    <div className="pomo-page-task-label">{pomoTaskName}</div>
                  )}
                </div>
              </div>
              {pomoSettingsOpen && (
                <div className="pomo-settings">
                  <div className="pomo-settings-group">
                  <div className="pomo-settings-label"><span className="dot" />Focus duration (minutes)</div>
                  <div className="pomo-settings-presets">
                    {[5, 10, 15, 20, 25, 30, 45, 60].map(m => (
                      <button
                        key={m}
                        className={"pomo-settings-preset" + (pomoMinutes === m && !pomoCustomInput ? " active" : "")}
                        onClick={() => applyPomoMinutes(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <div className="pomo-settings-custom">
                    <input
                      className="pomo-settings-input"
                      type="number" min="1" max="240" placeholder="Custom"
                      value={pomoCustomInput}
                      onChange={e => setPomoCustomInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const v = parseInt(pomoCustomInput);
                          if (v >= 1 && v <= 240) applyPomoMinutes(v);
                        }
                      }}
                    />
                    <button
                      className="pomo-settings-apply"
                      disabled={!pomoCustomInput || parseInt(pomoCustomInput) < 1 || parseInt(pomoCustomInput) > 240}
                      onClick={() => { const v = parseInt(pomoCustomInput); if (v >= 1 && v <= 240) applyPomoMinutes(v); }}
                    >
                      Apply
                    </button>
                  </div>
                  </div>
                  <div className="pomo-settings-group rose">
                  <div className="pomo-settings-label"><span className="dot" />Break duration (minutes)</div>
                  <div className="pomo-settings-presets">
                    {[5, 10, 15, 20, 30].map(m => (
                      <button
                        key={m}
                        className={"pomo-settings-preset" + (pomoBreakMinutes === m && !pomoBreakCustomInput ? " active" : "")}
                        onClick={() => applyPomoBreakMinutes(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <div className="pomo-settings-custom">
                    <input
                      className="pomo-settings-input"
                      type="number" min="1" max="240" placeholder="Custom"
                      value={pomoBreakCustomInput}
                      onChange={e => setPomoBreakCustomInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const v = parseInt(pomoBreakCustomInput);
                          if (v >= 1 && v <= 240) applyPomoBreakMinutes(v);
                        }
                      }}
                    />
                    <button
                      className="pomo-settings-apply"
                      disabled={!pomoBreakCustomInput || parseInt(pomoBreakCustomInput) < 1 || parseInt(pomoBreakCustomInput) > 240}
                      onClick={() => { const v = parseInt(pomoBreakCustomInput); if (v >= 1 && v <= 240) applyPomoBreakMinutes(v); }}
                    >
                      Apply
                    </button>
                  </div>
                  </div>
                </div>
              )}
              <div className="pomo-page-ctrl">
                <div className="pomo-btn-wrap" style={{ flex: 1 }}>
                  {!pomoTaskChosen ? (
                    <button className="pbtn-main pomo-page-btn" onClick={() => setPomoPickerOpen(true)}>
                      <ChecklistIcon />
                      Select a task
                    </button>
                  ) : (
                    <button className="pbtn-main pomo-page-btn" onClick={() => {
                      if (pomoRemain === 0) { setPomoRemain(POMO_TOTAL); setPomoRunning(true); }
                      else { setPomoRunning((r) => !r); }
                    }}>
                      {pomoRunning ? <PauseIcon /> : <PlayIcon />}
                      {pomoRunning ? "Pause" : (pomoRemain === POMO_TOTAL || pomoRemain === 0) ? "Start" : "Resume"}
                    </button>
                  )}
                </div>
                <button className="pbtn-reset pomo-page-reset" aria-label="Skip to end" title="Skip to end" disabled={pomoRemain === POMO_TOTAL} onClick={completeCurrentPhase}>
                  <SkipIcon />
                </button>
                <button className="pbtn-reset pomo-page-reset" aria-label="Reset" disabled={pomoRemain === POMO_TOTAL} onClick={resetPomo}>
                  <ResetIcon />
                </button>
                <button
                  className={"pbtn-reset pomo-page-reset" + (pomoSettingsOpen ? " active" : "")}
                  aria-label="Settings" title="Timer settings"
                  disabled={pomoRunning}
                  onClick={() => { setPomoSettingsOpen(o => !o); setPomoCustomInput(""); }}
                >
                  <GearIcon />
                </button>
              </div>
            </div>
          </div>

          {(() => {
            const TL_START = 6 * 3600;
            const TL_END = 24 * 3600;
            const TL_RANGE = TL_END - TL_START;
            const HOUR_MARKS = [6, 9, 12, 15, 18, 21, 24];

            // Group sessions by calendar date key "YYYY-MM-DD"
            const grouped = new Map<string, PomoSession[]>();
            // Always include today even if empty
            const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; })();
            grouped.set(todayKey, []);
            pomoHistory.forEach(s => {
              const d = new Date(s.completedAt);
              const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(s);
            });
            const sortedDays = [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
            const uniqueTasks = [...new Map(pomoHistory.map(s => [s.task, s])).values()];

            return (
              <div className="pomo-tl">
                {sortedDays.map(([key, sessions]) => {
                  const [y, mo, d] = key.split("-").map(Number);
                  const dayStartMs = new Date(y, mo - 1, d).getTime();
                  const totalMin = Math.round(sessions.reduce((a, s) => a + s.duration, 0) / 60);
                  return (
                    <div key={key} className="pomo-tl-day">
                      <div className="pomo-tl-header">
                        <span className="pomo-tl-label">{dayLabel(key)}</span>
                        {sessions.length > 0 && (
                          <span className="pomo-tl-meta">{sessions.length} session{sessions.length !== 1 ? "s" : ""} · {totalMin} min</span>
                        )}
                      </div>
                      <div className="pomo-tl-track">
                        {HOUR_MARKS.map(h => (
                          <div key={h} className="pomo-tl-mark" style={{ left: `${((h * 3600 - TL_START) / TL_RANGE) * 100}%` }}>
                            <span>{h < 12 ? `${h}am` : h === 12 ? "12pm" : h === 24 ? "12am" : `${h - 12}pm`}</span>
                          </div>
                        ))}
                        {sessions.map((s, i) => {
                          const startSec = (s.completedAt - dayStartMs) / 1000 - s.duration;
                          const leftPct = Math.max(0, (startSec - TL_START) / TL_RANGE) * 100;
                          const widthPct = Math.min(100 - leftPct, (s.duration / TL_RANGE) * 100);
                          const tooltip = `${s.task ?? "No task"}\n${formatHHMM(s.completedAt - s.duration * 1000)} – ${formatHHMM(s.completedAt)}`;
                          return (
                            <div
                              key={i}
                              className="pomo-tl-block"
                              style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%`, background: pomoTaskColor(s.task, pomoHistory) }}
                              data-tooltip={tooltip}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {uniqueTasks.length > 0 && (
                  <div className="pomo-tl-legend">
                    {uniqueTasks.map((s, i) => (
                      <span key={i} className="pomo-tl-legend-item">
                        <i style={{ background: pomoTaskColor(s.task, pomoHistory) }} />
                        {s.task ?? "No task"}
                      </span>
                    ))}
                  </div>
                )}
                {!pomoHistoryExhausted && (
                  <button
                    type="button"
                    className="pomo-tl-load-more"
                    onClick={loadEarlierPomoSessions}
                    disabled={pomoHistoryLoadingMore}
                  >
                    <span className="pomo-tl-load-inner">
                      {pomoHistoryLoadingMore
                        ? <SpinnerIcon className="spin" />
                        : <ChevronDownIcon className="pomo-tl-load-chevron" />}
                      {pomoHistoryLoadingMore ? "Loading" : "Load earlier days"}
                    </span>
                  </button>
                )}
              </div>
            );
          })()}
        </>
      )}

      {screen === "settings" && (
        <div className="page narrow">
          <div className="page-header">
            <div>
              <h1 className="page-title">Settings</h1>
              <p className="page-sub">Account, appearance, and connected services.</p>
            </div>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Account</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Name</div>
                <div className="settings-row-desc">Shown in your account menu.</div>
              </div>
              <div className="settings-row-control">
                <input
                  className="settings-input"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveProfileName(); }}
                  placeholder="Your name"
                />
                <button
                  className="settings-save-btn"
                  disabled={nameDraft.trim() === profileName.trim() || !nameDraft.trim()}
                  onClick={saveProfileName}
                >
                  {nameSaved ? "Saved" : "Save"}
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Email</div>
                <div className="settings-row-desc">Used to sign in — managed by your account provider.</div>
              </div>
              <div className="settings-row-control">
                <span className="settings-static-value">{email}</span>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Password</div>
                <div className="settings-row-desc">
                  {passwordError ? <span className="settings-row-error">{passwordError}</span> : "Update the password used to sign in."}
                </div>
              </div>
              <div className="settings-row-control">
                <input
                  className="settings-input"
                  type="password"
                  value={passwordDraft}
                  onChange={(e) => { setPasswordDraft(e.target.value); setPasswordError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") savePassword(); }}
                  placeholder="New password"
                  autoComplete="new-password"
                />
                <button
                  className="settings-save-btn"
                  disabled={!passwordDraft.trim()}
                  onClick={savePassword}
                >
                  {passwordSaved ? "Saved" : "Save"}
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Appearance</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Dark mode</div>
                <div className="settings-row-desc">Switch the whole dashboard to a darker palette.</div>
              </div>
              <div className="settings-row-control">
                <button
                  className={"settings-switch" + (darkMode ? " on" : "")}
                  role="switch" aria-checked={darkMode}
                  onClick={() => setDarkMode((d) => !d)}
                >
                  <span className="settings-switch-knob" />
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Glass mode</div>
                <div className="settings-row-desc">Adds a frosted, translucent look to cards.</div>
              </div>
              <div className="settings-row-control">
                <button
                  className={"settings-switch" + (glass ? " on" : "")}
                  role="switch" aria-checked={glass}
                  onClick={() => setGlass((g) => !g)}
                >
                  <span className="settings-switch-knob" />
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Accent</div>
                <div className="settings-row-desc">Colour for progress, tags and the timer. Auto is sage in light mode and blue in dark mode.</div>
              </div>
              <div className="settings-row-control">
                <div className="seg" role="radiogroup" aria-label="Accent">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.label}
                      role="radio"
                      aria-checked={accent === a.value}
                      className={"seg-btn" + (accent === a.value ? " active" : "")}
                      onClick={() => setAccent(a.value)}
                    >
                      {a.swatch && <i className="seg-swatch" style={{ background: a.swatch }} />}
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Voice</div>
                <div className="settings-row-desc">The typeface for the clock, the timer and titles.</div>
              </div>
              <div className="settings-row-control">
                <div className="seg" role="radiogroup" aria-label="Voice">
                  {VOICES.map((v) => (
                    <button
                      key={v.label}
                      role="radio"
                      aria-checked={voice === v.value}
                      className={"seg-btn" + (voice === v.value ? " active" : "")}
                      onClick={() => setVoice(v.value)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Integrations</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Microsoft To Do</div>
                <div className="settings-row-desc">Powers the Tasks screen and home to-do widget.</div>
              </div>
              <div className="settings-row-control">
                {microsoftConnected ? (
                  <>
                    <span className="connect-btn connected">Connected</span>
                    <button className="settings-disconnect-btn" onClick={handleDisconnectMicrosoft}>Disconnect</button>
                  </>
                ) : (
                  <a href="/auth/microsoft" className="connect-btn">Connect</a>
                )}
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Google Calendar</div>
                <div className="settings-row-desc">Powers the calendar widget on the home screen.</div>
              </div>
              <div className="settings-row-control">
                {googleConnected ? (
                  <>
                    <span className="connect-btn connected">Connected</span>
                    <button className="settings-disconnect-btn" onClick={handleDisconnectGoogle}>Disconnect</button>
                  </>
                ) : (
                  <a href="/auth/google" className="connect-btn">Connect</a>
                )}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Focus timer</h2>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Notify when a timer ends</div>
                <div className="settings-row-desc">Show a browser notification when a focus session or break finishes.</div>
              </div>
              <div className="settings-row-control">
                <button
                  className={"settings-switch" + (pomoNotify ? " on" : "")}
                  role="switch" aria-checked={pomoNotify}
                  onClick={togglePomoNotify}
                >
                  <span className="settings-switch-knob" />
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Auto-start next phase</div>
                <div className="settings-row-desc">When a timer ends, automatically start the next phase instead of pausing.</div>
              </div>
              <div className="settings-row-control">
                <button
                  className={"settings-switch" + (pomoAutoStart ? " on" : "")}
                  role="switch" aria-checked={pomoAutoStart}
                  onClick={() => setPomoAutoStart((a) => !a)}
                >
                  <span className="settings-switch-knob" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
