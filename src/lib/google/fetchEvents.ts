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

function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// dateISO: "YYYY-MM-DD" for the day to fetch (server-local timezone)
export async function fetchDayEvents(dateISO: string): Promise<CalendarResult> {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) return { status: "disconnected" };

  const dayStart = new Date(`${dateISO}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

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
    return {
      id: e.id,
      title: e.summary || "(untitled)",
      start: hhmm(s),
      end: hhmm(en),
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: en.getHours() * 60 + en.getMinutes() || 24 * 60,
      allDay,
    };
  });

  return { status: "ok", events };
}
