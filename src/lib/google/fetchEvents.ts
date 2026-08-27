import { getGoogleAccessToken } from "./getAccessToken";
import { eventsForDay, zonedMidnightUtc, type GcalEvent } from "./mapEvents";
import type { CalendarDays, CalendarEvent, CalendarResult } from "./types";

export type { CalendarDays, CalendarEvent, CalendarResult };

// Fetch every requested day in a single Google Calendar call.
//
// The days need not be contiguous — one request spans the whole min..max range
// and the results are bucketed per day afterwards. Asking for a day at a time
// meant one OAuth exchange and one API round trip each, which is what made a
// dashboard load slow.
//
// dateISOs: "YYYY-MM-DD" days to fetch, interpreted in `timeZone`
// (the viewer's IANA timezone, e.g. "Europe/London") — not the server's own.
export async function fetchDaysEvents(
  dateISOs: string[],
  timeZone: string
): Promise<CalendarResult> {
  const days = [...new Set(dateISOs)].sort();
  if (days.length === 0) return { status: "ok", days: {} };

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) return { status: "disconnected" };

  const rangeStart = zonedMidnightUtc(days[0], timeZone);
  const rangeEnd = zonedMidnightUtc(days[days.length - 1], timeZone);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

  const params = new URLSearchParams({
    timeMin: rangeStart.toISOString(),
    timeMax: rangeEnd.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 401) return { status: "disconnected" };

  const empty: CalendarDays = Object.fromEntries(days.map((iso) => [iso, []]));
  if (!res.ok) return { status: "ok", days: empty };

  const data = await res.json();
  const items: GcalEvent[] = data.items ?? [];

  const bucketed: CalendarDays = {};
  for (const iso of days) bucketed[iso] = eventsForDay(items, iso, timeZone);

  return { status: "ok", days: bucketed };
}
