import { fetchMicrosoftTasks } from "@/lib/microsoft/fetchTasks";
import { resolveTaskPins } from "@/lib/data/taskPinQueries";

// Task reads go through a Route Handler rather than a Server Action: Server
// Actions are queued and run sequentially, so an on-mount fetch through one
// would sit in the same queue as the calendar's.

export async function GET() {
  try {
    const tasks = await fetchMicrosoftTasks();
    // The pinned flag lives in Supabase, not To Do, so it is resolved here
    // instead of costing the dashboard a second round trip.
    const withPins = await resolveTaskPins(tasks);
    return Response.json(withPins, {
      // Per-user data: never let a shared cache hold on to it.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[GET /api/tasks]", err);
    return Response.json({ error: "failed to fetch tasks" }, { status: 500 });
  }
}
