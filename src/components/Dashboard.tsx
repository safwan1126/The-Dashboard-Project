"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------- to-do ---------- */
type Task = { name: string; time: string; done: boolean };
const INITIAL_TASKS: Task[] = [
  { name: "Review PRD draft", time: "09:30", done: true },
  { name: "Design sync with dev", time: "11:00", done: true },
  { name: "Gym – push day", time: "13:00", done: false },
  { name: "Ship dashboard mockups", time: "15:30", done: false },
  { name: "Write weekly notes", time: "18:00", done: false },
  { name: "Read 20 pages", time: "21:30", done: false },
];

/* ---------- habits ---------- */
// 1 = done, 0 = missed, -1 = future
type Habit = { name: string; days: number[]; strk: number };
const INITIAL_HABITS: Habit[] = [
  { name: "Meditate", days: [1, 1, 0, 1, 1, -1, -1], strk: 4 },
  { name: "Read", days: [1, 1, 1, 0, 1, -1, -1], strk: 3 },
  { name: "Workout", days: [0, 1, 0, 1, 1, -1, -1], strk: 1 },
  { name: "Hydrate", days: [1, 1, 1, 1, 1, -1, -1], strk: 6 },
  { name: "No sugar", days: [0, 0, 0, 0, 0, -1, -1], strk: 0 },
];

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

export default function Dashboard({ email }: { email: string }) {
  /* ---------- clock ---------- */
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

  /* ---------- to-do ---------- */
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  function toggleTask(i: number) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, done: !t.done } : t)));
  }

  function finishAdd(commit: boolean) {
    const trimmed = draft.trim();
    if (commit && trimmed) {
      const d = new Date();
      setTasks((prev) => [...prev, { name: trimmed, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, done: false }]);
    }
    setAdding(false);
    setDraft("");
  }

  const doneCount = tasks.filter((t) => t.done).length;
  const progressPct = Math.round((doneCount / tasks.length) * 100);

  /* ---------- quick note / capture ---------- */
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
  const [habits, setHabits] = useState<Habit[]>(INITIAL_HABITS);
  function toggleHabit(hi: number, di: number) {
    setHabits((prev) =>
      prev.map((h, i) =>
        i !== hi
          ? h
          : { ...h, days: h.days.map((v, j) => (j === di ? (v ? 0 : 1) : v)) }
      )
    );
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
        <div className="crumb">Tasks&nbsp;&nbsp;/&nbsp;&nbsp;<b>Home</b></div>
        <div className="topclock num">{now ? `${clockStr}:${secStr}` : "--:--:--"}</div>
      </header>

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
              <span className="tag plain"><span className="num">{doneCount}/{tasks.length}</span></span>
            </div>
            <div className="todo-prog">
              <div className="bar"><i style={{ width: `${progressPct}%` }} /></div>
            </div>
            <div className="todo-list">
              {tasks.map((t, i) => (
                <div
                  key={i}
                  className={"todo-item" + (t.done ? " done" : "")}
                  onClick={() => toggleTask(i)}
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
        </div>

        {/* ===== CENTER ===== */}
        <div className="col">
          <div className="clockblock">
            <div className="bigclock">{clockStr}<span className="sec">:{secStr}</span></div>
            <div className="bigdate">{dateStr}</div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title" style={{ display: "none" }} />
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

          <div className="card">
            <div className="card-head">
              <div className="card-title">Habit Tracker</div>
              <span className="tag plain">This week</span>
            </div>
            <div className="habit-head">
              <span className="h">Habit</span>
              <span className="d">M</span><span className="d">T</span><span className="d">W</span>
              <span className="d">T</span><span className="d">F</span><span className="d">S</span><span className="d">S</span>
              <span className="s">Strk</span>
            </div>
            <div>
              {habits.map((hb, hi) => (
                <div className="habit-row" key={hi}>
                  <span className="hn">{hb.name}</span>
                  {hb.days.map((v, di) => (
                    <span
                      key={di}
                      className={"hcell" + (v === 1 ? " on" : v === -1 ? " future" : "")}
                      onClick={() => v !== -1 && toggleHabit(hi, di)}
                    />
                  ))}
                  <span className="strk">{hb.strk}</span>
                </div>
              ))}
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
