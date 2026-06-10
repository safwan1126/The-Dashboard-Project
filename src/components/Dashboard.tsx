"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signOut } from "@/app/auth/actions";
import { syncTasksToMicrosoft } from "@/lib/microsoft/syncTasks";
import { fetchMicrosoftTasks } from "@/lib/microsoft/fetchTasks";
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
type Task = { name: string; time: string; done: boolean; starred: boolean };
const INITIAL_TASKS: Task[] = [
  { name: "Review PRD draft", time: "09:30", done: true, starred: true },
  { name: "Design sync with dev", time: "11:00", done: true, starred: true },
  { name: "Gym – push day", time: "13:00", done: false, starred: true },
  { name: "Ship dashboard mockups", time: "15:30", done: false, starred: true },
  { name: "Write weekly notes", time: "18:00", done: false, starred: false },
  { name: "Read 20 pages", time: "21:30", done: false, starred: false },
];

/* ---------- habits ---------- */
// frequency: days of week (0=Sun..6=Sat) the habit is scheduled on; empty = every day
type Habit = HabitRow;

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/* ---------- calendar ---------- */
const FIRST_DAY = 1;
const TOTAL_DAYS = 30;
const TODAY = 7;
const EVENTS = new Set([5, 14, 18, 22]);

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
  initialHabits,
}: {
  email: string;
  microsoftConnected: boolean;
  initialHabits: Habit[];
}) {
  /* ---------- screen ---------- */
  const [screen, setScreen] = useState<"home" | "tasks" | "habits">("home");

  /* ---------- microsoft sync ---------- */
  const [syncing, startSync] = useTransition();
  const [syncStatus, setSyncStatus] = useState<"idle" | "success" | "error">("idle");
  const isFirstRender = useRef(true);

  /* ---------- clock ---------- */
  /* ---------- dark mode ---------- */
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("darkMode");
    if (stored === "true") setDarkMode(true);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-mood", darkMode ? "Charcoal" : "");
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

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
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
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
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
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

  // On mount, fetch tasks from Microsoft and merge any new ones in
  useEffect(() => {
    if (!microsoftConnected) return;
    fetchMicrosoftTasks().then((remoteTasks) => {
      if (!remoteTasks.length) return;
      setTasks((prev) => {
        const existingNames = new Set(prev.map((t) => t.name));
        const newTasks = remoteTasks
          .filter((rt) => !existingNames.has(rt.name))
          .map((rt) => ({
            name: rt.name,
            time: "--:--",
            done: rt.done,
            starred: false,
          }));
        // Also update done status for tasks that exist in both places
        const updated = prev.map((t) => {
          const remote = remoteTasks.find((rt) => rt.name === t.name);
          return remote ? { ...t, done: remote.done } : t;
        });
        return [...updated, ...newTasks];
      });
      isFirstRender.current = false;
    });
  }, []);

  // Auto-sync to Microsoft on every task change (skip the initial mount)
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

  /* ---------- calendar ---------- */
  const calCells: { label: number; muted: boolean; today: boolean; event: boolean }[] = [];
  for (let p = 0; p < FIRST_DAY; p++) {
    calCells.push({ label: 31 - FIRST_DAY + 1 + p, muted: true, today: false, event: false });
  }
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    calCells.push({ label: d, muted: false, today: d === TODAY, event: EVENTS.has(d) });
  }

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
  }

  const pomoTime = `${pad(Math.floor(remain / 60))}:${pad(remain % 60)}`;
  const pomoOffset = (CIRC * (remain / TOTAL)).toFixed(1);

  return (
    <div className="stage">
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
                <a
                  href={microsoftConnected ? undefined : "/auth/microsoft"}
                  className={"ms-connect-btn" + (microsoftConnected ? " connected" : "")}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                    <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                    <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                    <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                  </svg>
                  {microsoftConnected ? "Microsoft To Do connected" : "Connect Microsoft To Do"}
                </a>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div className="card-title">To-Do List</div>
                <span className="tag plain"><span className="num">{doneCount}/{starredTasks.length}</span></span>
              </div>
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
                <div className="card-title">01 // Habits</div>
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
                <div className="m">June 2026</div>
                <div className="cal-nav">
                  <button aria-label="Previous">‹</button>
                  <button aria-label="Next">›</button>
                </div>
              </div>
              <div className="cal-grid">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
                  <div className="wd" key={w}>{w.toUpperCase()}</div>
                ))}
                {calCells.map((c, i) => (
                  <div
                    key={i}
                    className={"cal-day" + (c.muted ? " muted" : "") + (c.today ? " today" : "")}
                  >
                    {c.label}
                    {c.event && <span className="dot" />}
                  </div>
                ))}
              </div>
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
                <div className="pomo-ctrl">
                  <button className="pbtn-main" onClick={() => setRunning((r) => !r)}>
                    {running ? <PauseIcon /> : <PlayIcon />}
                    {running ? "Pause" : "Start"}
                  </button>
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
          <div className="tasks-header">
            <div>
              <h1 className="tasks-title">All Tasks</h1>
              <p className="tasks-sub">{tasks.length} tasks · {tasks.filter(t => t.starred).length} pinned to To-Do</p>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              {microsoftConnected && (
                <span className={"ms-sync-btn" + (syncStatus === "success" ? " success" : syncStatus === "error" ? " error" : "")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" className={syncing ? "spin" : ""}>
                    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                  {syncing ? "Syncing…" : syncStatus === "success" ? "Synced!" : syncStatus === "error" ? "Sync failed" : "Auto-sync on"}
                </span>
              )}
              <button className="add-task tasks-add-btn" onClick={() => setTasksAdding(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New task
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
                            onBlur={() => finishTasksAdd(true)}
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
                          onBlur={() => finishTasksAdd(true)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}
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

      {/* ===== RIGHT RAIL ===== */}
      <nav className="rail">
        <button aria-label="Play"><PlayIcon /></button>
        <button aria-label="Bookmark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button aria-label="Chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.8-.9L3 20l1-3.8A8.5 8.5 0 0 1 12 3a8.38 8.38 0 0 1 9 8.5z" />
          </svg>
        </button>
        <button aria-label="Sign out" onClick={() => signOut()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </nav>
    </div>
  );
}
