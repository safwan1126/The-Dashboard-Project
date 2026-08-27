import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;

  if (!code) {
    return NextResponse.redirect(`${siteUrl}?error=google_auth_failed`);
  }

  const redirectUri = `${siteUrl}auth/google/callback`;

  // Exchange the code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error("Google token exchange failed:", tokens);
    return NextResponse.redirect(`${siteUrl}?error=google_token_failed`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${siteUrl}login?error=not_logged_in`);
  }

  const { error } = await supabase
    .from("google_tokens")
    .upsert({
      user_id: user.id,
      refresh_token: tokens.refresh_token,
      // Drop any cached access token — it may belong to the previously
      // connected Google account.
      access_token: null,
      access_token_expires_at: null,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error("Failed to store Google token:", error);
    return NextResponse.redirect(`${siteUrl}?error=token_storage_failed`);
  }

  return NextResponse.redirect(`${siteUrl}?google_connected=true`);
}
