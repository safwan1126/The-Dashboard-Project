import type { NextRequest } from "next/server";
import { fetchDaysEvents } from "@/lib/google/fetchEvents";

// Calendar reads go through a Route Handler rather than a Server Action:
// Server Actions are queued and run sequentially, so using them to fetch data
// made the dashboard's calendar requests pile up behind one another.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Guard against a silly range blowing up the Google query window.
const MAX_DAYS = 31;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const days = (searchParams.get("days") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => ISO_DAY.test(d));

  if (days.length === 0) {
    return Response.json({ error: "no valid days requested" }, { status: 400 });
  }
  if (days.length > MAX_DAYS) {
    return Response.json({ error: `at most ${MAX_DAYS} days per request` }, { status: 400 });
  }

  const timeZone = searchParams.get("tz") || "UTC";
  // Reject anything Intl won't accept, rather than letting it throw mid-parse.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return Response.json({ error: "invalid timezone" }, { status: 400 });
  }

  const result = await fetchDaysEvents(days, timeZone);

  // Per-user calendar data: never let a shared cache hold on to it.
  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
