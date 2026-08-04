"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { syncTasksToMicrosoft, deleteTaskFromMicrosoft } from "@/lib/microsoft/syncTasks";
import { fetchMicrosoftTasks } from "@/lib/microsoft/fetchTasks";
import { fetchDayEvents, type CalendarEvent } from "@/lib/google/fetchEvents";
import {
  addHabit as addHabitAction,
  deleteHabit as deleteHabitAction,
  updateHabitFrequency as updateHabitFrequencyAction,
  toggleHabitToday as toggleHabitTodayAction,
  type HabitRow,
  type HabitCompletion,
} from "@/lib/data/habits";
import { addPomoSession, getPomoSessions, getAllPomoSessions } from "@/lib/data/pomoSessions";
import { POMO_COOKIE, serializePomoState, type PomoState, type PomoPhase } from "@/lib/pomodoro";
import { updateProfileName, changePassword, disconnectMicrosoft, disconnectGoogle } from "@/lib/settings/actions";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Falls back to a readable name derived from the email for users who signed up
// before the name field existed (drops purely-numeric segments, title-cases).
function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").trim();
  if (!local) return "User";
  const words = local.split(/[._-]+/).filter((w) => w && !/^\d+$/.test(w));
  if (words.length === 0) return local;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function initialsFrom(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------- task ---------- */
type Task = { msId?: string; name: string; time: string; done: boolean; starred: boolean };

/* ---------- habits ---------- */
// frequency: days of week (0=Sun..6=Sat) the habit is scheduled on; empty = every day
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 5v14l12-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function TimerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="2" x2="14" y2="2" />
      <line x1="12" y1="14" x2="12" y2="10" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "rotate(45deg)" }}>
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function PinOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "rotate(45deg)" }}>
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export default function Dashboard({
  email,
  name: initialName,
  microsoftConnected,
  googleConnected,
  initialHabits,
  initialHabitCompletions,
  initialPomo,
}: {
  email: string;
  name: string;
  microsoftConnected: boolean;
  googleConnected: boolean;
  initialHabits: Habit[];
  initialHabitCompletions: HabitCompletion[];
  initialPomo: PomoState;
}) {
  /* ---------- screen ---------- */
  // Views are switched with the History API (shallow routing) rather than
  // router.push. Pushing a new route would refetch this dynamic page's server
  // payload on every tab click; pushState updates the URL — and useSearchParams,
  // which stays in sync — without any server round-trip.
  const router = useRouter();
  const searchParams = useSearchParams();
  const screen = (searchParams.get("screen") ?? "home") as "home" | "tasks" | "habits" | "tracker" | "pomodoro" | "settings";
  function setScreen(s: "home" | "tasks" | "habits" | "tracker" | "pomodoro" | "settings") {
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

  /* ---------- profile name ---------- */
  const [profileName, setProfileName] = useState(initialName);
  const [nameDraft, setNameDraft] = useState(initialName);
  const [nameSaved, setNameSaved] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const displayName = profileName.trim() || nameFromEmail(email);
  const avatarInitials = initialsFrom(displayName);

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

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
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
  // Microsoft To Do has no "pinned" concept, so the starred flag can't round-trip
  // through the sync — it's tracked locally by task name instead.
  const PINNED_KEY = "pinnedTaskNames";
  function readPinned(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(PINNED_KEY) || "[]")); } catch { return new Set(); }
  }
  function setPinned(name: string, starred: boolean) {
    const pinned = readPinned();
    if (starred) pinned.add(name); else pinned.delete(name);
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
  }

  const [tasks, setTasks] = useState<Task[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const tasksAddInputRef = useRef<HTMLInputElement>(null);
  const [tasksAdding, setTasksAdding] = useState(false);
  const [tasksDraft, setTasksDraft] = useState("");

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (tasksAdding) tasksAddInputRef.current?.focus();
  }, [tasksAdding]);

  function toggleTask(i: number) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, done: !t.done } : t)));
  }

  function toggleStar(i: number) {
    setTasks((prev) => prev.map((t, idx) => {
      if (idx !== i) return t;
      const starred = !t.starred;
      setPinned(t.name, starred);
      return { ...t, starred };
    }));
  }

  function deleteTask(i: number) {
    const task = tasks[i];
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
    setPinned(task.name, false);
    if (microsoftConnected && task.msId) deleteTaskFromMicrosoft(task.msId);
  }

  function finishAdd(commit: boolean) {
    const trimmed = draft.trim();
    if (commit && trimmed) {
      const d = new Date();
      setPinned(trimmed, true);
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

  // On mount, fetch tasks from Microsoft
  useEffect(() => {
    if (!microsoftConnected) return;
    const pinned = readPinned();
    fetchMicrosoftTasks().then((remoteTasks) => {
      setTasks(remoteTasks.map((rt) => ({
        msId: rt.id,
        name: rt.name,
        time: "--:--",
        done: rt.done,
        starred: pinned.has(rt.name),
      })));
      isFirstRender.current = false;
    });
  }, []);

  // Auto-sync to Microsoft on every task change (skip the initial fetch)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!microsoftConnected) return;
    startSync(async () => {
      const result = await syncTasksToMicrosoft(tasks);
      setSyncStatus(result.success ? "success" : "error");
      setTimeout(() => setSyncStatus("idle"), 3000);
    });
  }, [tasks]);

  const starredTasks = tasks.filter((t) => t.starred);
  const doneCount = starredTasks.filter((t) => t.done).length;
  const progressPct = starredTasks.length ? Math.round((doneCount / starredTasks.length) * 100) : 0;

  /* ---------- quick note ---------- */
  const [note, setNote] = useState(
    "Ship the v2 dashboard before standup. Ping Dana re: the nutrition API quota — we're at 80% for June. Don't forget to water the monstera 🌱"
  );
  const [capture, setCapture] = useState("");

  function onCaptureKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && capture.trim()) {
      setNote(capture.trim());
      setCapture("");
    }
  }

  /* ---------- habits ---------- */
  const [habits, setHabits] = useState<Habit[]>(initialHabits);
  const [habitCompletions, setHabitCompletions] = useState<Set<string>>(
    () => new Set(initialHabitCompletions.map((c) => `${c.habitId}|${c.date}`))
  );
  function toggleHabit(id: string) {
    const h = habits.find((h) => h.id === id);
    if (!h) return;
    const nowDone = !h.done;
    setHabits((prev) =>
      prev.map((x) => (x.id === id ? { ...x, done: nowDone, strk: x.strk + (nowDone ? 1 : -1) } : x))
    );
    setHabitCompletions((prev) => {
      const next = new Set(prev);
      const key = `${id}|${dateKey(new Date())}`;
      if (nowDone) next.add(key);
      else next.delete(key);
      return next;
    });
    toggleHabitTodayAction(id, h.done, h.strk);
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
  const habitsToday = habits.filter((h) => h.frequency.length === 0 || h.frequency.includes(todayDow));
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
  // Manual fix for accounts where Google's reported event times are off
  // (seen with some users even though the server-side fetch/format logic is timezone-correct).
  const [calOffsetMin, setCalOffsetMin] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = Number(localStorage.getItem("calOffsetMin"));
    return Number.isFinite(v) ? v : 0;
  });
  useEffect(() => {
    localStorage.setItem("calOffsetMin", String(calOffsetMin));
  }, [calOffsetMin]);
  const calCache = useRef(new Map<string, CalendarEvent[]>());
  const calFetching = useRef(new Set<string>());

  function isoOf(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function isoShift(iso: string, delta: number) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return isoOf(d);
  }
  const calDateISO = isoOf(calDate);

  // Fetch a day into the cache (deduped); returns the events or null if disconnected
  async function loadDay(iso: string): Promise<CalendarEvent[] | null> {
    if (calFetching.current.has(iso)) return calCache.current.get(iso) ?? null;
    calFetching.current.add(iso);
    try {
      const result = await fetchDayEvents(iso);
      if (result.status === "disconnected") {
        setCalState("disconnected");
        return null;
      }
      calCache.current.set(iso, result.events);
      return result.events;
    } finally {
      calFetching.current.delete(iso);
    }
  }

  useEffect(() => {
    if (!googleConnected) return;
    let stale = false;

    const cached = calCache.current.get(calDateISO);
    if (cached) {
      // Instant render from cache, then refresh quietly in the background
      setCalEvents(cached);
      setCalState("ok");
      loadDay(calDateISO).then((events) => {
        if (!stale && events) setCalEvents(events);
      });
    } else {
      setCalState("loading");
      loadDay(calDateISO).then((events) => {
        if (stale || !events) return;
        setCalEvents(events);
        setCalState("ok");
      });
    }

    // Prefetch the whole visible week, the neighbours, and today,
    // so the week strip, ‹ ›, and "Today" all feel instant
    const mondayOffset = -((calDate.getDay() + 6) % 7);
    const prefetch = new Set<string>([isoShift(calDateISO, -1), isoShift(calDateISO, 1), isoOf(new Date())]);
    for (let i = 0; i < 7; i++) prefetch.add(isoShift(calDateISO, mondayOffset + i));
    for (const iso of prefetch) {
      if (iso !== calDateISO && !calCache.current.has(iso)) loadDay(iso);
    }

    return () => { stale = true; };
  }, [googleConnected, calDateISO]);

  /* ---------- "Up next" (Pomodoro screen): next Google Calendar event ---------- */
  type UpNextEvent = CalendarEvent & { dayOffset: 0 | 1 };
  const [upNextEvents, setUpNextEvents] = useState<UpNextEvent[] | null>(null);

  useEffect(() => {
    if (!googleConnected) return;
    let stale = false;
    (async () => {
      const todayISO = isoOf(new Date());
      const tomorrowISO = isoShift(todayISO, 1);
      const [todayRes, tomorrowRes] = await Promise.all([
        fetchDayEvents(todayISO),
        fetchDayEvents(tomorrowISO),
      ]);
      if (stale) return;
      setUpNextEvents([
        ...(todayRes.status === "ok" ? todayRes.events.map((e) => ({ ...e, dayOffset: 0 as const })) : []),
        ...(tomorrowRes.status === "ok" ? tomorrowRes.events.map((e) => ({ ...e, dayOffset: 1 as const })) : []),
      ]);
    })();
    return () => { stale = true; };
  }, [googleConnected, dateStr]);

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
  const shiftedCalEvents = (calEvents ?? []).map((e) => {
    if (e.allDay || calOffsetMin === 0) return e;
    const startMin = e.startMin + calOffsetMin;
    const endMin = e.endMin + calOffsetMin;
    const toHHMM = (min: number) => {
      const m = ((min % 1440) + 1440) % 1440;
      return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    };
    return { ...e, startMin, endMin, start: toHHMM(startMin), end: toHHMM(endMin) };
  });
  const timedEvents = shiftedCalEvents.filter((e) => !e.allDay);
  const allDayEvents = shiftedCalEvents.filter((e) => e.allDay);
  const calStartHour = Math.min(7, ...timedEvents.map((e) => Math.floor(e.startMin / 60)));
  const calEndHour = Math.max(22, ...timedEvents.map((e) => Math.ceil(e.endMin / 60)));

  /* ---------- heatmap: daily focus time from pomodoro sessions ---------- */
  // All-time focus minutes per local calendar day (keyed YYYY-MM-DD, matching
  // the pomodoro timeline's grouping). Paging is then pure client-side math.
  const [focusByDay, setFocusByDay] = useState<Map<string, number> | null>(null);
  const [heatPage, setHeatPage] = useState(0); // 0 = current 15 weeks, 1 = previous, ...
  useEffect(() => {
    getAllPomoSessions()
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
    getPomoSessions(pomoHistoryDays)
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
  const nextUpProgressPct = nextUpInProgress
    ? Math.min(100, Math.max(0, ((nowTotalSec - nextUpStartSec) / (nextUpEndSec - nextUpStartSec)) * 100))
    : 0;

  return (
    <div className="stage">
      {/* ===== TOP BAR ===== */}
      <header className="topbar">
        <div className="brand">
          <div className="name">LifeOS</div>
          <div className="sub">Personal operating system</div>
        </div>
        <nav className="screen-nav">
          <button
            className={"screen-nav-btn" + (screen === "home" ? " active" : "")}
            onClick={() => setScreen("home")}
          >
            Home
          </button>
          <span className="screen-nav-sep">|</span>
          <button
            className={"screen-nav-btn" + (screen === "tasks" ? " active" : "")}
            onClick={() => setScreen("tasks")}
          >
            Tasks
          </button>
          <span className="screen-nav-sep">|</span>
          <button
            className={"screen-nav-btn" + (screen === "habits" ? " active" : "")}
            onClick={() => setScreen("habits")}
          >
            Habits
          </button>
          <span className="screen-nav-sep">|</span>
          <button
            className={"screen-nav-btn" + (screen === "tracker" ? " active" : "")}
            onClick={() => setScreen("tracker")}
          >
            Tracker
          </button>
          <span className="screen-nav-sep">|</span>
          <button
            className={"screen-nav-btn" + (screen === "pomodoro" ? " active" : "")}
            onClick={() => setScreen("pomodoro")}
          >
            Pomodoro
          </button>
        </nav>
        <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            className="dark-toggle"
            onClick={() => setScreen("settings")}
            aria-label="Settings"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="topclock num">{now ? `${clockStr}:${secStr}` : "--:--:--"}</div>
        </div>
      </header>

      {screen === "home" ? (
        <div className="grid">
          {/* ===== LEFT ===== */}
          <div className="col">
            <div className="card profile">
              <div className="avatar">{avatarInitials}</div>
              <div>
                <h2>{displayName}</h2>
                <div className="role">{email || "Product designer"}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">To-Do List</div>
                {microsoftConnected && <span className="tag plain"><span className="num">{doneCount}/{starredTasks.length}</span></span>}
              </div>
              {microsoftConnected ? (
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
                        <span className="time">{t.time}</span>
                      </div>
                    ))}
                  </div>
                  {adding ? (
                    <input
                      ref={addInputRef}
                      className="add-input"
                      placeholder="Task name, then Enter…"
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
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add task
                    </button>
                  )}
                </>
              ) : (
                <div className="todo-connect-prompt">
                  <p className="todo-connect-msg">Connect Microsoft To Do to manage your tasks — they'll sync across all your devices.</p>
                  <a href="/auth/microsoft" className="ms-connect-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                      <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                      <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                      <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                      <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                    </svg>
                    Connect Microsoft To Do
                  </a>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <span className="tag rose">Quick Note</span>
              </div>
              <p className="note-body">{note}</p>
              <div className="note-divider" />
              <div className="capture">
                <input
                  type="text"
                  placeholder="Capture a thought…"
                  value={capture}
                  onChange={(e) => setCapture(e.target.value)}
                  onKeyDown={onCaptureKeyDown}
                />
              </div>
            </div>
          </div>

          {/* ===== CENTER ===== */}
          <div className="col">
            <div className="clockblock">
              <div className="bigclock">{clockStr}<span className="sec">:{secStr}</span></div>
              <div className="bigdate">{dateStr}</div>
            </div>

            {googleConnected && nextUpEvent && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Next Up</div>
                  <span className="tag num">{nextUpInProgress ? "Now" : formatDurationMin(nextUpCountdownMin)}</span>
                </div>
                <div className="next-up-title">{nextUpEvent.title}</div>
                <div className="next-up-meta">
                  <span className="next-up-meta-item">
                    <ClockIcon />
                    {nextUpEvent.dayOffset === 1 ? "Tomorrow · " : ""}{nextUpEvent.start} → {nextUpEvent.end}
                  </span>
                  <span className="next-up-meta-sep" />
                  <span className="next-up-meta-item">
                    <TimerIcon />
                    {formatDurationMin(nextUpEvent.endMin - nextUpEvent.startMin)}
                  </span>
                </div>
                <div className="next-up-track">
                  <div className="next-up-track-row">
                    <span className="next-up-track-label num">Now {clockStr}</span>
                    <span className="next-up-track-mid">
                      {nextUpInProgress ? `Ends in ${formatDurationMin(nextUpCountdownMin)}` : `Starts in ${formatDurationMin(nextUpCountdownMin)}`}
                    </span>
                    <span className="next-up-track-label num">{nextUpEvent.end}</span>
                  </div>
                  <div className="bar next-up-track-bar"><i style={{ width: `${nextUpProgressPct}%` }} /></div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="cal-head">
                <div className="m">{calLabel}</div>
                <div className="cal-nav">
                  <a
                    href="https://calendar.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cal-open-btn"
                    title="Open Google Calendar"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
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
                <a href="/auth/google" className="ms-connect-btn" style={{ marginTop: 0 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
                  </svg>
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
                      const height = Math.max((ev.endMin - ev.startMin) * CAL_PX_PER_MIN, 22);
                      return (
                        <div key={ev.id} className="cal-block" style={{ top: `${top}px`, height: `${height}px` }} title={`${ev.title} · ${ev.start} – ${ev.end}`}>
                          <span className="cal-block-title">{ev.title}</span>
                          {height > 34 && <span className="cal-block-time num">{ev.start} – {ev.end}</span>}
                        </div>
                      );
                    })}
                    <div style={{ height: `${(calEndHour - calStartHour) * 60 * CAL_PX_PER_MIN + 14}px` }} />
                  </div>
                  {calState === "ok" && timedEvents.length === 0 && allDayEvents.length === 0 && (
                    <p className="cal-empty">No events — clear runway.</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ===== RIGHT ===== */}
          <div className="col">
            <div className="card habits-card">
              <div className="card-head">
                <div className="card-title">Habits</div>
                <span className="tag plain">{habitsDone}/{habitsToday.length} · {habitsPct}%</span>
              </div>

              <div className="habits-score">
                <div className="habits-score-badge">{habitsDone}</div>
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
                {habits.map((hb) => {
                  if (!(hb.frequency.length === 0 || hb.frequency.includes(todayDow))) return null;
                  return (
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
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                        </svg>
                        {hb.strk}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">Activity</div>
                <div className="heat-nav">
                  <span className="tag plain"><b style={{ color: "var(--ink-2)", fontWeight: 600 }} className="num">{Math.round(heatTotalMin / 60)}</b> hrs</span>
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
        <div className="tasks-screen">
          {!microsoftConnected ? (
            <div className="tasks-connect-wall">
              <div className="tasks-connect-inner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="40" height="40" style={{ opacity: 0.35 }}>
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <h2 className="tasks-connect-title">Tasks require Microsoft To Do</h2>
                <p className="tasks-connect-msg">Your tasks are stored in Microsoft To Do and sync across all your devices. Connect your account to get started.</p>
                <a href="/auth/microsoft" className="ms-connect-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                    <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                    <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                    <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                  </svg>
                  Connect Microsoft To Do
                </a>
              </div>
            </div>
          ) : (
          <>
          <div className="tasks-header">
            <div>
              <h1 className="tasks-title">All Tasks</h1>
              <p className="tasks-sub">{tasks.length} tasks · {tasks.filter(t => t.starred).length} pinned to To-Do</p>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <span className="ms-connect-btn connected" style={{ marginTop: 0 }}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                  <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                  <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                  <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                </svg>
                Microsoft To Do connected
              </span>
              <span className={"ms-sync-btn" + (syncStatus === "success" ? " success" : syncStatus === "error" ? " error" : "")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" className={syncing ? "spin" : ""}>
                  <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
                {syncing ? "Syncing…" : syncStatus === "success" ? "Synced!" : syncStatus === "error" ? "Sync failed" : "Auto-sync on"}
              </span>
              <button className={"add-task tasks-add-btn" + (tasksAdding ? " cancelling" : "")} onClick={() => { setTasksAdding((v) => !v); setTasksDraft(""); }}>
                {tasksAdding ? (
                  "Cancel"
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
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
                <span className="tasks-name">{t.name}</span>
                <span className="tasks-time num">{t.time}</span>
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

      {screen === "habits" && (
        /* ===== HABITS SCREEN ===== */
        <div className="tasks-screen">
          <div className="tasks-header">
            <div>
              <h1 className="tasks-title">All Habits</h1>
              <p className="tasks-sub">{habits.length} habits · {habitsToday.length} scheduled today</p>
            </div>
            <button className="add-task tasks-add-btn" onClick={() => setHabitAdding(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New habit
            </button>
          </div>

          <div className="tasks-list-full">
            {habitAdding && (
              <div className="habit-row habit-row-adding">
                <input
                  ref={habitAddInputRef}
                  className="add-input"
                  placeholder="Habit name, then Enter…"
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
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleDraftFreqDay(d)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <button className="add-task" style={{ width: "auto" }} onMouseDown={(e) => e.preventDefault()} onClick={() => finishHabitAdd(true)}>
                  Add
                </button>
                <button className="habit-cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => finishHabitAdd(false)}>
                  Cancel
                </button>
              </div>
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
                      onClick={() => toggleHabitFreqDay(hb.id, d)}
                      title={hb.frequency.length === 0 ? "Every day (toggle a day to restrict)" : undefined}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <div className="habit-strk">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                  </svg>
                  {hb.strk}
                </div>
                <button className="tasks-delete" onClick={() => deleteHabit(hb.id)} aria-label="Delete habit">
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === "tracker" && (
        /* ===== HABIT TRACKER SCREEN ===== */
        <div className="tracker-screen">
          <div className="tasks-header">
            <div>
              <h1 className="tasks-title">Habit Tracker</h1>
              <p className="tasks-sub">{habits.length} habits · last {TRACKER_DAYS} days</p>
            </div>
          </div>

          <div className="tracker-table-wrap">
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
                      No habits yet — add one from the Habits tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                <svg width={POMO_SIZE} height={POMO_SIZE}>
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
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 4 15 12 5 20 5 4" />
                    <line x1="19" y1="5" x2="19" y2="19" />
                  </svg>
                </button>
                <button className="pbtn-reset pomo-page-reset" aria-label="Reset" disabled={pomoRemain === POMO_TOTAL} onClick={resetPomo}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 4v6h6" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
                <button
                  className={"pbtn-reset pomo-page-reset" + (pomoSettingsOpen ? " active" : "")}
                  aria-label="Settings" title="Timer settings"
                  disabled={pomoRunning}
                  onClick={() => { setPomoSettingsOpen(o => !o); setPomoCustomInput(""); }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
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
                      <svg
                        viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        width="12" height="12"
                        className={pomoHistoryLoadingMore ? "spin" : "pomo-tl-load-chevron"}
                      >
                        {pomoHistoryLoadingMore
                          ? <path d="M21 12a9 9 0 1 1-6.2-8.5" />
                          : <path d="M6 9l6 6 6-6" />}
                      </svg>
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
        <div className="settings-screen">
          <div className="settings-header">
            <h1 className="settings-title">Settings</h1>
            <p className="settings-sub">Account, appearance, and connected services.</p>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Account</h2>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Name</div>
                <div className="settings-row-desc">Shown on your profile and to-do widget.</div>
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
              <div>
                <div className="settings-row-label">Email</div>
                <div className="settings-row-desc">Used to sign in — managed by your account provider.</div>
              </div>
              <div className="settings-row-control">
                <span className="settings-static-value">{email}</span>
              </div>
            </div>
            <div className="settings-row">
              <div>
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
              <div>
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
              <div>
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
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Integrations</h2>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Microsoft To Do</div>
                <div className="settings-row-desc">Powers the Tasks screen and home to-do widget.</div>
              </div>
              <div className="settings-row-control">
                {microsoftConnected ? (
                  <>
                    <span className="ms-connect-btn connected" style={{ marginTop: 0 }}>Connected</span>
                    <button className="settings-disconnect-btn" onClick={handleDisconnectMicrosoft}>Disconnect</button>
                  </>
                ) : (
                  <a href="/auth/microsoft" className="ms-connect-btn" style={{ marginTop: 0 }}>Connect</a>
                )}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Google Calendar</div>
                <div className="settings-row-desc">Powers the calendar widget on the home screen.</div>
              </div>
              <div className="settings-row-control">
                {googleConnected ? (
                  <>
                    <span className="ms-connect-btn connected" style={{ marginTop: 0 }}>Connected</span>
                    <button className="settings-disconnect-btn" onClick={handleDisconnectGoogle}>Disconnect</button>
                  </>
                ) : (
                  <a href="/auth/google" className="ms-connect-btn" style={{ marginTop: 0 }}>Connect</a>
                )}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Calendar time correction</div>
                <div className="settings-row-desc">If your Google Calendar events show up at the wrong time, nudge this until they line up.</div>
              </div>
              <div className="settings-row-control">
                <button className="settings-disconnect-btn" onClick={() => setCalOffsetMin((m) => m - 60)}>−1h</button>
                <span className="num" style={{ minWidth: 36, textAlign: "center" }}>
                  {calOffsetMin === 0 ? "0h" : `${calOffsetMin > 0 ? "+" : ""}${calOffsetMin / 60}h`}
                </span>
                <button className="settings-disconnect-btn" onClick={() => setCalOffsetMin((m) => m + 60)}>+1h</button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Pomodoro</h2>
            <div className="settings-row">
              <div>
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
              <div>
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
