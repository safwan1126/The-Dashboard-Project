"use server";

import { getGoogleAccessToken } from "./getAccessToken";

type GcalEvent = {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // "HH:MM", "" for all-day
  end: string;
  startMin: number; // minutes since midnight, for timeline positioning
  endMin: number;
  allDay: boolean;
};

export type CalendarResult =
  | { status: "ok"; events: CalendarEvent[] }
  | { status: "disconnected" };

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
function zonedMidnightUtc(dateISO: string, timeZone: string): Date {
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

// dateISO: "YYYY-MM-DD" for the day to fetch, interpreted in `timeZone`
// (the viewer's IANA timezone, e.g. "Europe/London") — not the server's own.
export async function fetchDayEvents(dateISO: string, timeZone: string): Promise<CalendarResult> {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) return { status: "disconnected" };

  const dayStart = zonedMidnightUtc(dateISO, timeZone);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 401) return { status: "disconnected" };
  if (!res.ok) return { status: "ok", events: [] };

  const data = await res.json();

  const events: CalendarEvent[] = (data.items ?? []).map((e: GcalEvent) => {
    const allDay = !e.start.dateTime;
    if (allDay) {
      return { id: e.id, title: e.summary || "(untitled)", start: "", end: "", startMin: 0, endMin: 0, allDay };
    }
    // Clamp multi-day timed events to this day's window
    const s = new Date(Math.max(new Date(e.start.dateTime!).getTime(), dayStart.getTime()));
    const en = new Date(Math.min(new Date(e.end.dateTime!).getTime(), dayEnd.getTime()));
    const sHM = zonedHourMinute(s, timeZone);
    const enHM = zonedHourMinute(en, timeZone);
    return {
      id: e.id,
      title: e.summary || "(untitled)",
      start: `${pad(sHM.hour)}:${pad(sHM.minute)}`,
      end: `${pad(enHM.hour)}:${pad(enHM.minute)}`,
      startMin: sHM.hour * 60 + sHM.minute,
      endMin: (enHM.hour * 60 + enHM.minute) || 24 * 60,
      allDay,
    };
  });

  return { status: "ok", events };
}
