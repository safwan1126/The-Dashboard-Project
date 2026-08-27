// Read side of the pomodoro session history.
//
// Split out from pomoSessions.ts (which stays a Server Action module for the
// insert) because reads are served by a Route Handler instead: Server Actions
// are queued and run sequentially, so fetching through them made the dashboard's
// on-mount requests wait on one another.

import { createClient } from "@/lib/supabase/server";
import type { PomoSessionRow } from "./pomoTypes";

export type { PomoSessionRow };

type Row = { id: string; task_name: string | null; completed_at: string; duration: number };

function toSessionRows(rows: Row[]): PomoSessionRow[] {
  return rows.map((row) => ({
    id: row.id,
    taskName: row.task_name,
    completedAt: new Date(row.completed_at).getTime(),
    duration: row.duration,
  }));
}

export async function getPomoSessions(days = 14): Promise<PomoSessionRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("pomo_sessions")
    .select("id, task_name, completed_at, duration")
    .gte("completed_at", since.toISOString())
    .order("completed_at", { ascending: true });

  if (error) { console.error("[getPomoSessions]", error); throw error; }

  return toSessionRows(data ?? []);
}

// All of the user's sessions, newest first. Used by the activity heatmap, which
// pages back through the full retained history rather than a fixed window.
export async function getAllPomoSessions(): Promise<PomoSessionRow[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("pomo_sessions")
    .select("id, task_name, completed_at, duration")
    .order("completed_at", { ascending: false });

  if (error) { console.error("[getAllPomoSessions]", error); throw error; }

  return toSessionRows(data ?? []);
}
