import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "@/components/Dashboard";
import { getHabits, getHabitCompletionsRange } from "@/lib/data/habits";
import { POMO_COOKIE, parsePomoState } from "@/lib/pomodoro";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const trackerEnd = new Date();
  const trackerStart = new Date(trackerEnd);
  trackerStart.setDate(trackerStart.getDate() - 29);
  const toDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // These reads are independent — run them concurrently instead of
  // stacking their round-trips end-to-end.
  const [{ data: tokenRow }, { data: googleTokenRow }, { data: profileRow }, habits, habitCompletions, cookieStore] = await Promise.all([
    supabase.from("microsoft_tokens").select("user_id").eq("user_id", user.id).single(),
    supabase.from("google_tokens").select("user_id").eq("user_id", user.id).single(),
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    getHabits(user.id),
    getHabitCompletionsRange(toDateKey(trackerStart), toDateKey(trackerEnd), user.id),
    cookies(),
  ]);

  // Seed the pomodoro timer from its cookie so a refresh renders the continued
  // time on the server — no flash of the default 25:00 while the client hydrates.
  const initialPomo = parsePomoState(cookieStore.get(POMO_COOKIE)?.value);

  return (
    <Suspense>
      <Dashboard
        email={user.email ?? ""}
        name={String(profileRow?.full_name ?? "")}
        microsoftConnected={!!tokenRow}
        googleConnected={!!googleTokenRow}
        initialHabits={habits}
        initialHabitCompletions={habitCompletions}
        initialPomo={initialPomo}
      />
    </Suspense>
  );
}
