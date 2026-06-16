"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
} from "@/lib/data/habits";

function pad(n: number) {
  return String(n).padStart(2, "0");
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

/* ---------- heatmap ---------- */
const SHADES = [
  "oklch(var(--tint) / 0.07)",
  "var(--sage-faint)",
  "var(--sage-soft)",
  "var(--sage)",
  "var(--sage-deep)",
];

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
  microsoftConnected,
  googleConnected,
  initialHabits,
}: {
  email: string;
  microsoftConnected: boolean;
  googleConnected: boolean;
  initialHabits: Habit[];
}) {
  /* ---------- screen ---------- */
  const router = useRouter();
  const searchParams = useSearchParams();
  const screen = (searchParams.get("screen") ?? "home") as "home" | "tasks" | "habits";
  function setScreen(s: "home" | "tasks" | "habits") {
    const params = new URLSearchParams(searchParams.toString());
    if (s === "home") params.delete("screen");
    else params.set("screen", s);
    router.push(`?${params.toString()}`);
  }

  /* ---------- microsoft sync ---------- */
  const [syncing, startSync] = useTransition();
  const [syncStatus, setSyncStatus] = useState<"idle" | "success" | "error">("idle");
  const isFirstRender = useRef(true);

  /* ---------- clock ---------- */
  /* ---------- dark mode ---------- */
  const [darkMode, setDarkMode] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("darkMode") === "true"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-mood", darkMode ? "Charcoal" : "");
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

  /* ---------- glass mode ---------- */
  const [glass, setGlass] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("glass") === "true"
  );
  useEffect(() => {
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
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, starred: !t.starred } : t)));
  }

  function deleteTask(i: number) {
    const task = tasks[i];
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
    if (microsoftConnected && task.msId) deleteTaskFromMicrosoft(task.msId);
  }

  function finishAdd(commit: boolean) {
    const trimmed = draft.trim();
    if (commit && trimmed) {
      const d = new Date();
      setTasks((prev) => [...prev, { name: trimmed, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, done: false, starred: false }]);
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
    fetchMicrosoftTasks().then((remoteTasks) => {
      setTasks(remoteTasks.map((rt) => ({
        msId: rt.id,
        name: rt.name,
        time: "--:--",
        done: rt.done,
        starred: false,
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
  function toggleHabit(id: string) {
    const h = habits.find((h) => h.id === id);
    if (!h) return;
    const nowDone = !h.done;
    setHabits((prev) =>
      prev.map((x) => (x.id === id ? { ...x, done: nowDone, strk: x.strk + (nowDone ? 1 : -1) } : x))
    );
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

  /* ---------- heatmap (client-only random to avoid hydration mismatch) ---------- */
  const [heat, setHeat] = useState<number[] | null>(null);
  useEffect(() => {
    setHeat(
      Array.from({ length: 15 * 7 }, () =>
        Math.random() < 0.3 ? 0 : 1 + Math.floor(Math.random() * 4)
      )
    );
  }, []);

  /* ---------- pomodoro ---------- */
  const TOTAL = 25 * 60;
  const CIRC = 515.2;
  const [remain, setRemain] = useState(TOTAL);
  const [running, setRunning] = useState(false);
  const [pomoTaskIdx, setPomoTaskIdx] = useState<number | null>(null);
  const [pomoTaskChosen, setPomoTaskChosen] = useState(false);
  const [pomoPickerOpen, setPomoPickerOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => {
        setRemain((r) => {
          if (r > 0) return r - 1;
          if (timerRef.current) clearInterval(timerRef.current);
          setRunning(false);
          return 0;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running]);

  function resetPomo() {
    setRunning(false);
    setRemain(TOTAL);
    setPomoTaskIdx(null);
    setPomoTaskChosen(false);
    setPomoPickerOpen(false);
  }

  const pomoTime = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`;
  const pomoOffset = (CIRC * (remain / TOTAL)).toFixed(1);

  return (
    <div className="stage">
      {/* ===== TASK PICKER MODAL ===== */}
      {pomoPickerOpen && !running && (
        <div className="pomo-modal-backdrop" onClick={() => setPomoPickerOpen(false)}>
          <div className="pomo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pomo-modal-title">Focus on a task</div>
            <div className="pomo-modal-list">
              <button
                className={"pomo-picker-item" + (pomoTaskChosen && pomoTaskIdx === null ? " active" : "")}
                onClick={() => { setPomoTaskIdx(null); setPomoTaskChosen(true); setPomoPickerOpen(false); }}
              >
                No task
              </button>
              {tasks.filter((t) => !t.done).map((t) => {
                const idx = tasks.indexOf(t);
                return (
                  <button
                    key={idx}
                    className={"pomo-picker-item" + (pomoTaskIdx === idx ? " active" : "")}
                    onClick={() => { setPomoTaskIdx(idx); setPomoTaskChosen(true); setPomoPickerOpen(false); }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* ===== TOP BAR ===== */}
      <header className="topbar">
        <div className="brand">
          <div className="name">NeeyazOS</div>
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
        </nav>
        <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            className={"dark-toggle" + (glass ? " active" : "")}
            onClick={() => setGlass((g) => !g)}
            aria-label="Toggle glass mode"
            title={glass ? "Glass mode on" : "Glass mode off"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </button>
          <button
            className="dark-toggle"
            onClick={() => setDarkMode((d) => !d)}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            {darkMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <div className="topclock num">{now ? `${clockStr}:${secStr}` : "--:--:--"}</div>
        </div>
      </header>

      {screen === "home" ? (
        <div className="grid">
          {/* ===== LEFT ===== */}
          <div className="col">
            <div className="card profile">
              <div className="avatar">NA</div>
              <div>
                <h2>Neeyaz Ahmed</h2>
                <div className="role">{email || "Product designer"}</div>
                <div className="pills">
                  <span className="pill">Focused</span>
                  <span className="pill rose"><span className="num">12</span>-day streak</span>
                </div>
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
            <div className="card">
              <div className="card-head">
                <div className="card-title">Nutrition</div>
                <span className="tag">Today</span>
              </div>
              <div className="nutri-top">
                <div className="ring">
                  <svg width="88" height="88">
                    <circle cx="44" cy="44" r="39" fill="none" stroke="var(--sage-track)" strokeWidth="7" />
                    <circle
                      cx="44" cy="44" r="39" fill="none" stroke="var(--sage)" strokeWidth="7"
                      strokeLinecap="round" strokeDasharray="245" strokeDashoffset="68.6"
                    />
                  </svg>
                  <div className="ring-c"><b className="num">72</b></div>
                </div>
                <div className="nutri-cal">
                  <div className="big num">1,584</div>
                  <div className="lbl"><b>/ 2,200</b> kcal consumed</div>
                </div>
              </div>
              <div className="macros">
                <div>
                  <div className="mline"><span className="mn">Protein</span><span className="mv num">98 / 130g</span></div>
                  <div className="mbar"><i style={{ width: "75%", background: "var(--sage)" }} /></div>
                </div>
                <div>
                  <div className="mline"><span className="mn">Carbs</span><span className="mv num">176 / 240g</span></div>
                  <div className="mbar"><i style={{ width: "73%", background: "var(--rose)" }} /></div>
                </div>
                <div>
                  <div className="mline"><span className="mn">Fat</span><span className="mv num">52 / 70g</span></div>
                  <div className="mbar"><i style={{ width: "74%", background: "var(--sage-soft)" }} /></div>
                </div>
              </div>
              <div className="water">
                <div className="wtop"><span className="wn">Water</span><span className="wv num">6/8 glasses</span></div>
                <div className="glasses">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className={"glass" + (i < 6 ? " full" : "")} />
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">Pomodoro</div>
                <span className="tag rose"><span className="num">3</span> Done</span>
              </div>
              <div className="pomo">
                <div className="pomo-ring">
                  <svg width="178" height="178">
                    <circle cx="89" cy="89" r="82" fill="none" stroke="oklch(var(--tint) / 0.08)" strokeWidth="2.5" />
                    <circle
                      cx="89" cy="89" r="82" fill="none" stroke="var(--sage)" strokeWidth="2.5"
                      strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={pomoOffset}
                    />
                  </svg>
                  <div className="pomo-c">
                    <div>
                      <div className="mode">Focus</div>
                      <div className="ptime num">{pomoTime}</div>
                    </div>
                  </div>
                </div>
                {pomoTaskChosen && pomoTaskIdx !== null && tasks[pomoTaskIdx] && (
                  <div className="pomo-active-task">{tasks[pomoTaskIdx].name}</div>
                )}
                <div className="pomo-ctrl">
                  <div className="pomo-btn-wrap">
                    {!pomoTaskChosen ? (
                      <button className="pbtn-main" onClick={() => setPomoPickerOpen(true)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </svg>
                        Select a task
                      </button>
                    ) : (
                      <button className="pbtn-main" onClick={() => setRunning((r) => !r)}>
                        {running ? <PauseIcon /> : <PlayIcon />}
                        {running ? "Pause" : "Start"}
                      </button>
                    )}
                  </div>
                  <button className="pbtn-reset" aria-label="Reset" onClick={resetPomo}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4v6h6" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                  </button>
                </div>
                <div className="pomo-dots">
                  <i className="done" /><i className="done" /><i className="done" /><i />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">Activity</div>
                <span className="tag plain"><b style={{ color: "var(--ink-2)", fontWeight: 600 }} className="num">428</b> this quarter</span>
              </div>
              <div className="heat">
                {(heat ?? Array.from({ length: 15 * 7 }, () => 0)).map((lvl, i) => (
                  <div key={i} className="hc" style={{ background: SHADES[lvl] }} />
                ))}
              </div>
              <div className="heat-legend">
                <span>15 Weeks</span>
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

    </div>
  );
}
