"use server";

import { createClient } from "@/lib/supabase/server";

export type PomoSessionRow = {
  id: string;
  taskName: string | null;
  completedAt: number;
  duration: number;
};

export async function addPomoSession(
  taskName: string | null,
  completedAt: number,
  duration: number
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("pomo_sessions").insert({
    user_id: user.id,
    task_name: taskName,
    completed_at: new Date(completedAt).toISOString(),
    duration,
  });

  if (error) throw error;
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

  return (data ?? []).map(row => ({
    id: row.id,
    taskName: row.task_name,
    completedAt: new Date(row.completed_at).getTime(),
    duration: row.duration,
  }));
}
