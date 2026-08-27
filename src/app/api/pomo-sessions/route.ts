import type { NextRequest } from "next/server";
import { getAllPomoSessions, getPomoSessions } from "@/lib/data/pomoSessionQueries";

// Session-history reads go through a Route Handler rather than a Server Action:
// Server Actions are queued and run sequentially, so the dashboard's on-mount
// fetches would wait on one another.

// The heatmap asks for everything; the timeline asks for a rolling window.
const MAX_DAYS = 3650;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const all = searchParams.get("all") === "1";

  let days = 14;
  if (!all) {
    const raw = searchParams.get("days");
    if (raw !== null) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
        return Response.json({ error: "invalid days" }, { status: 400 });
      }
      days = parsed;
    }
  }

  try {
    const rows = all ? await getAllPomoSessions() : await getPomoSessions(days);
    return Response.json(rows, {
      // Per-user data: never let a shared cache hold on to it.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[GET /api/pomo-sessions]", err);
    return Response.json({ error: "failed to fetch sessions" }, { status: 500 });
  }
}
