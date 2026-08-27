import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Treat a token as expired slightly early, so one that is about to lapse can't
// die in flight between this check and the Calendar API call.
const EXPIRY_SKEW_MS = 60_000;

// Fallback lifetime if Google omits `expires_in` (it normally sends 3599).
const DEFAULT_TTL_S = 3600;

// Coalesce concurrent refreshes within this process. A dashboard load can ask
// for a token several times at once; without this they would each fire their
// own OAuth exchange. Route Handlers may run as separate lambdas, so this is
// only an optimisation — the stored token below is what makes it correct.
const inFlight = new Map<string, Promise<string | null>>();

async function refreshAccessToken(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string
): Promise<string | null> {
  // Unlike Microsoft, Google does not rotate refresh tokens, so nothing to re-save.
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await res.json();
  if (!res.ok || !tokens.access_token) return null;

  const ttlSeconds = Number(tokens.expires_in) || DEFAULT_TTL_S;
  await supabase
    .from("google_tokens")
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
    .eq("user_id", userId);

  return tokens.access_token;
}

export async function getGoogleAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("google_tokens")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("user_id", user.id)
    .single();

  if (error || !data?.refresh_token) return null;

  // Reuse the stored access token until it is nearly expired. This is the hot
  // path: it turns a calendar fetch into one Supabase read instead of a read
  // plus a full OAuth exchange.
  const expiresAt = data.access_token_expires_at
    ? new Date(data.access_token_expires_at).getTime()
    : 0;
  if (data.access_token && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return data.access_token;
  }

  const pending = inFlight.get(user.id);
  if (pending) return pending;

  const refresh = refreshAccessToken(supabase, user.id, data.refresh_token).finally(() => {
    inFlight.delete(user.id);
  });
  inFlight.set(user.id, refresh);
  return refresh;
}
