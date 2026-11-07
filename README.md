# LifeOS

A personal dashboard

https://the-dashboard-project.vercel.app/ 

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
