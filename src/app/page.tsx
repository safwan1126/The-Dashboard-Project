import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: tokenRow } = await supabase
    .from("microsoft_tokens")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  return <Dashboard email={user.email ?? ""} microsoftConnected={!!tokenRow} />;
}
