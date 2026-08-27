-- Cache the short-lived Google access token next to the refresh token.
--
-- Google access tokens are valid for ~1 hour, but every calendar fetch used to
-- re-exchange the refresh token, paying a full OAuth round trip to
-- oauth2.googleapis.com per request. Storing the access token lets the common
-- case skip that hop entirely.
alter table public.google_tokens
  add column if not exists access_token text,
  add column if not exists access_token_expires_at timestamptz;
