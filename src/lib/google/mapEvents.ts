// Pure mapping between Google Calendar's payload and the shape the UI renders.
// Kept free of server imports so it can be unit tested directly.

import type { CalendarEvent } from "./types";

export type GcalEvent = {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Wall-clock hour/minute for an absolute instant, as seen in `timeZone`.
// Deliberately not `date.getHours()` — that reads the server process's own
// timezone, which has no reason to match the viewer's.
function zonedHourMinute(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
}

// Midnight of `dateISO` ("YYYY-MM-DD") as an absolute instant in `timeZone`.
export function zonedMidnightUtc(dateISO: string, timeZone: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asIfUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

// Narrow a batch of raw Google events down to the ones landing on `dateISO`,
// clamped to that day's window.
export function eventsForDay(
  items: GcalEvent[],
  dateISO: string,
  timeZone: string
): CalendarEvent[] {
  const dayStart = zonedMidnightUtc(dateISO, timeZone);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const events: CalendarEvent[] = [];

  for (const e of items) {
    const allDay = !e.start.dateTime;

    if (allDay) {
      // All-day events carry plain dates, `end.date` being exclusive.
      // "YYYY-MM-DD" strings compare correctly as text.
      const from = e.start.date;
      if (!from) continue;
      const to = e.end?.date;
      const onThisDay = to ? from <= dateISO && dateISO < to : from === dateISO;
      if (!onThisDay) continue;
      events.push({
        id: e.id, title: e.summary || "(untitled)",
        start: "", end: "", startMin: 0, endMin: 0, allDay,
      });
      continue;
    }

    const startsAt = new Date(e.start.dateTime!);
    const endsAt = new Date(e.end.dateTime!);
    if (endsAt <= dayStart || startsAt >= dayEnd) continue;

    // Clamp multi-day timed events to this day's window
    const s = new Date(Math.max(startsAt.getTime(), dayStart.getTime()));
    const en = new Date(Math.min(endsAt.getTime(), dayEnd.getTime()));
    const sHM = zonedHourMinute(s, timeZone);
    const enHM = zonedHourMinute(en, timeZone);
    events.push({
      id: e.id,
      title: e.summary || "(untitled)",
      start: `${pad(sHM.hour)}:${pad(sHM.minute)}`,
      end: `${pad(enHM.hour)}:${pad(enHM.minute)}`,
      startMin: sHM.hour * 60 + sHM.minute,
      endMin: (enHM.hour * 60 + enHM.minute) || 24 * 60,
      allDay,
    });
  }

  return events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMin - b.startMin);
}
