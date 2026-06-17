import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "@/components/Dashboard";
import { getHabits } from "@/lib/data/habits";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // These three reads are independent — run them concurrently instead of
  // stacking their round-trips end-to-end.
  const [{ data: tokenRow }, { data: googleTokenRow }, habits] = await Promise.all([
    supabase.from("microsoft_tokens").select("user_id").eq("user_id", user.id).single(),
    supabase.from("google_tokens").select("user_id").eq("user_id", user.id).single(),
    getHabits(user.id),
  ]);

  return (
    <Suspense>
      <Dashboard
        email={user.email ?? ""}
        microsoftConnected={!!tokenRow}
        googleConnected={!!googleTokenRow}
        initialHabits={habits}
      />
    </Suspense>
  );
}
