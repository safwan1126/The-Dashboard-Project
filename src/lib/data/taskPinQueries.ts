// Read side of the pinned-task flag.
//
// Split out from taskPins.ts (which stays a Server Action module for the
// writes) because the dashboard gets its pins from the /api/tasks Route
// Handler, alongside the Microsoft To Do fetch they belong to.

import { createClient } from "@/lib/supabase/server";
import type { RemoteTask } from "@/lib/microsoft/types";

export type PinnedTask = RemoteTask & { pinned: boolean };

type PinRow = { id: string; ms_task_id: string | null; name: string };

// Marks each task as pinned or not, and backfills the pin rows that were
// written before the task reached Microsoft To Do (or whose title has since
// changed there) so later lookups can go by the stable id.
export async function resolveTaskPins(tasks: RemoteTask[]): Promise<PinnedTask[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return tasks.map((t) => ({ ...t, pinned: false }));

  const { data, error } = await supabase
    .from("task_pins")
    .select("id, ms_task_id, name")
    .eq("user_id", user.id);
  if (error) throw error;

  const rows: PinRow[] = data ?? [];
  const byId = new Map(rows.filter((r) => r.ms_task_id).map((r) => [r.ms_task_id!, r]));
  const byName = new Map(rows.map((r) => [r.name, r]));

  const backfills: PromiseLike<unknown>[] = [];
  const resolved = tasks.map((task) => {
    const row = byId.get(task.id) ?? byName.get(task.name);
    if (!row) return { ...task, pinned: false };
    if (row.ms_task_id !== task.id || row.name !== task.name) {
      backfills.push(
        supabase
          .from("task_pins")
          .update({ ms_task_id: task.id, name: task.name })
          .eq("id", row.id)
          .eq("user_id", user.id)
      );
    }
    return { ...task, pinned: true };
  });

  // A failed backfill only costs another name match next time, so it never
  // fails the read.
  if (backfills.length > 0) {
    await Promise.allSettled(backfills);
  }

  return resolved;
}
