import { createClient } from "@/lib/supabase/server";

export async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get the stored refresh token
  const { data, error } = await supabase
    .from("microsoft_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();

  if (error || !data?.refresh_token) return null;

  // Exchange refresh token for a fresh access token
  const res = await fetch(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
        scope: "Tasks.ReadWrite offline_access",
      }),
    }
  );

  const tokens = await res.json();
  if (!res.ok || !tokens.access_token) return null;

  // Save the new refresh token (Microsoft rotates it each time)
  if (tokens.refresh_token) {
    await supabase
      .from("microsoft_tokens")
      .update({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
  }

  return tokens.access_token;
}
