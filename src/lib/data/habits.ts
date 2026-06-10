"use server";

import { createClient } from "@/lib/supabase/server";

export type HabitRow = {
  id: string;
  name: string;
  strk: number;
  done: boolean;
  frequency: number[];
};

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getHabits(): Promise<HabitRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: habits, error } = await supabase
    .from("habits")
    .select("id, name, strk, frequency")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const { data: completions, error: compError } = await supabase
    .from("habit_completions")
    .select("habit_id")
    .eq("user_id", user.id)
    .eq("date", todayDate());
  if (compError) throw compError;

  const doneToday = new Set((completions ?? []).map((c) => c.habit_id));

  return (habits ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    strk: h.strk,
    frequency: h.frequency ?? [],
    done: doneToday.has(h.id),
  }));
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
    .select("id, name, strk, frequency")
    .single();

  if (error) throw error;
  return { ...data, frequency: data.frequency ?? [], done: false };
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

// Toggles today's completion for a habit and adjusts its streak.
export async function toggleHabitToday(id: string, currentlyDone: boolean, currentStrk: number): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const date = todayDate();
  const newStrk = currentStrk + (currentlyDone ? -1 : 1);

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

  const { error: updateError } = await supabase.from("habits").update({ strk: newStrk }).eq("id", id);
  if (updateError) throw updateError;

  return newStrk;
}
