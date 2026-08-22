"use server";

import { createClient } from "@/lib/supabase/server";
import { computeStreak } from "@/lib/habitStreak";

export type HabitRow = {
  id: string;
  name: string;
  strk: number;
  done: boolean;
  frequency: number[];
  createdAt: string;
};

export type HabitCompletion = { habitId: string; date: string };

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// `userId` may be passed by callers that have already resolved the user (e.g.
// the page server component) to avoid a redundant auth.getUser() round-trip.
// Per-user access is enforced by RLS regardless of the id passed here.
export async function getHabits(userId?: string): Promise<HabitRow[]> {
  const supabase = await createClient();
  let uid = userId;
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    uid = user.id;
  }

  const [
    { data: habits, error },
    { data: completions, error: compError },
  ] = await Promise.all([
    supabase
      .from("habits")
      .select("id, name, strk, frequency, created_at")
      .order("created_at", { ascending: true }),
    supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("user_id", uid)
      .eq("date", todayDate()),
  ]);
  if (error) throw error;
  if (compError) throw compError;

  const doneToday = new Set((completions ?? []).map((c) => c.habit_id));

  return (habits ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    strk: h.strk,
    frequency: h.frequency ?? [],
    done: doneToday.has(h.id),
    createdAt: toDateKey(new Date(h.created_at)),
  }));
}

// Fetches every completion in [startDate, endDate] (inclusive, "YYYY-MM-DD")
// across all of the user's habits, for rendering the tracker table.
export async function getHabitCompletionsRange(
  startDate: string,
  endDate: string,
  userId?: string
): Promise<HabitCompletion[]> {
  const supabase = await createClient();
  let uid = userId;
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    uid = user.id;
  }

  const { data, error } = await supabase
    .from("habit_completions")
    .select("habit_id, date")
    .eq("user_id", uid)
    .gte("date", startDate)
    .lte("date", endDate);
  if (error) throw error;

  return (data ?? []).map((c) => ({ habitId: c.habit_id, date: c.date }));
}

export async function addHabit(name: string, frequency: number[]): Promise<HabitRow> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("habits")
    .insert({ user_id: user.id, name, frequency, strk: 0 })
    .select("id, name, strk, frequency, created_at")
    .single();

  if (error) throw error;
  return { ...data, frequency: data.frequency ?? [], done: false, createdAt: toDateKey(new Date(data.created_at)) };
}

export async function deleteHabit(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("habits").delete().eq("id", id);
  if (error) throw error;
}

export async function updateHabitFrequency(id: string, frequency: number[]): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("habits").update({ frequency }).eq("id", id);
  if (error) throw error;
}

// Toggles today's completion for a habit and recomputes its streak from
// actual completion history (so a missed scheduled day correctly resets it).
export async function toggleHabitToday(id: string, currentlyDone: boolean): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const date = todayDate();

  if (currentlyDone) {
    const { error } = await supabase
      .from("habit_completions")
      .delete()
      .eq("habit_id", id)
      .eq("user_id", user.id)
      .eq("date", date);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("habit_completions")
      .insert({ habit_id: id, user_id: user.id, date });
    if (error) throw error;
  }

  const [{ data: habitRow, error: habitError }, { data: completions, error: compError }] = await Promise.all([
    supabase.from("habits").select("frequency").eq("id", id).single(),
    supabase.from("habit_completions").select("date").eq("habit_id", id).eq("user_id", user.id),
  ]);
  if (habitError) throw habitError;
  if (compError) throw compError;

  const newStrk = computeStreak(habitRow.frequency ?? [], new Set((completions ?? []).map((c) => c.date)));

  const { error: updateError } = await supabase.from("habits").update({ strk: newStrk }).eq("id", id);
  if (updateError) throw updateError;

  return newStrk;
}
