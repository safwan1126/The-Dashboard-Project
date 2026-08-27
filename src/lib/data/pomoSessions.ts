"use server";

// Write side only. Mutations are what Server Actions are for; the reads live in
// pomoSessionQueries.ts and are served by a Route Handler, since Server Actions
// are queued and would serialise the dashboard's on-mount fetches.

import { createClient } from "@/lib/supabase/server";

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
