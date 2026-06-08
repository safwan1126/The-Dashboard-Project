# NeeyazOS

A personal dashboard — Next.js (App Router) + Supabase Auth, deployed on Vercel.

This recreates the **Sage** design from `legacy-static/` (the original HTML/CSS/JS
prototype is kept there for reference) as a real React app, gated behind
Supabase email/password authentication.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Supabase** — auth (email/password) via `@supabase/ssr`
- **Vercel** — hosting / deployment

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project at [supabase.com](https://supabase.com/dashboard),
   then copy `.env.local.example` to `.env.local` and fill in your project's
   URL and anon key (Project Settings → API):

   ```bash
   cp .env.local.example .env.local
   ```

3. In the Supabase dashboard, under **Authentication → URL Configuration**,
   add `http://localhost:3000/auth/callback` (and your production URL's
   equivalent) to the redirect allow-list.

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) — you'll be redirected
   to `/login`. Use **Sign up** to create an account (Supabase will email a
   confirmation link to `/auth/callback`), then sign in to see the dashboard.

## Project structure

- `src/app/page.tsx` — the dashboard route (server component, auth-gated)
- `src/app/login`, `src/app/signup` — auth screens
- `src/app/auth/actions.ts` — server actions for sign in / sign up / sign out
- `src/app/auth/callback/route.ts` — Supabase email-confirmation redirect handler
- `src/components/Dashboard.tsx` — the dashboard UI (client component, ported
  from the static Sage prototype: live clock, to-dos, habit tracker, calendar,
  nutrition, pomodoro timer, activity heatmap)
- `src/lib/supabase/` — browser/server Supabase client helpers + session-refresh proxy logic
- `src/proxy.ts` — Next.js Proxy (formerly "middleware"): refreshes the Supabase
  session and redirects signed-out users to `/login`
- `src/app/globals.css` — design tokens (oklch palette, fonts, radii) and all
  dashboard styling, ported 1:1 from the prototype

All dashboard data is currently placeholder/in-memory (matching the original
mockup) — Supabase is wired up for **auth** only so far. Persisting tasks,
habits, notes, etc. to a database is a natural next step.

## Deploying

1. Push this repo to GitHub.
2. Import it into [Vercel](https://vercel.com/new).
3. Add the same environment variables from `.env.local` to the Vercel project
   (Project Settings → Environment Variables), setting `NEXT_PUBLIC_SITE_URL`
   to your production URL (e.g. `https://your-app.vercel.app`).
4. Add the production callback URL (`https://your-app.vercel.app/auth/callback`)
   to Supabase's redirect allow-list.
5. Deploy.
