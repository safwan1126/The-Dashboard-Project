import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;

  if (!code) {
    return NextResponse.redirect(`${siteUrl}?error=microsoft_auth_failed`);
  }

  const redirectUri = `${siteUrl}auth/microsoft/callback`;

  // Exchange the code for tokens
  const tokenRes = await fetch(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }
  );

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error("Token exchange failed:", tokens);
    return NextResponse.redirect(`${siteUrl}?error=microsoft_token_failed`);
  }

  // Store the refresh token against the logged-in user in Supabase
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${siteUrl}login?error=not_logged_in`);
  }

  const { error } = await supabase
    .from("microsoft_tokens")
    .upsert({ user_id: user.id, refresh_token: tokens.refresh_token });

  if (error) {
    console.error("Failed to store token:", error);
    return NextResponse.redirect(`${siteUrl}?error=token_storage_failed`);
  }

  return NextResponse.redirect(`${siteUrl}?microsoft_connected=true`);
}
