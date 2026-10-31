"use server";

import { createClient } from "@/lib/supabase/server";

// `msTaskId` is null for a task that has only just been typed and has no
// Microsoft To Do id yet; the name carries the pin until the next fetch
// backfills the id (see taskPinQueries.ts).
export async function setTaskPin(
  msTaskId: string | null,
  name: string,
  pinned: boolean
): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  if (pinned) {
    const { error } = await supabase
      .from("task_pins")
      .upsert({ user_id: user.id, ms_task_id: msTaskId, name }, { onConflict: "user_id,name" });
    return { success: !error };
  }

  // Two deletes rather than one `or()` filter: a task name is free text and
  // would need escaping inside a filter string.
  const byName = supabase.from("task_pins").delete().eq("user_id", user.id).eq("name", name);
  const byId = msTaskId
    ? supabase.from("task_pins").delete().eq("user_id", user.id).eq("ms_task_id", msTaskId)
    : null;

  const results = await Promise.all(byId ? [byName, byId] : [byName]);
  return { success: results.every((r) => !r.error) };
}

// One-shot carry-over of the pins that used to live in localStorage. Harmless
// to call with names that are already pinned.
export async function importTaskPins(names: string[]): Promise<{ success: boolean }> {
  if (names.length === 0) return { success: true };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { error } = await supabase
    .from("task_pins")
    .upsert(
      names.map((name) => ({ user_id: user.id, ms_task_id: null, name })),
      { onConflict: "user_id,name", ignoreDuplicates: true }
    );
  return { success: !error };
}
