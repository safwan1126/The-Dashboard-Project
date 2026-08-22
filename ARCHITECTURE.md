# LifeOS — Architecture & Deep-Dive

> A reference document describing how this app is built, how the pieces fit
> together, and *why* things are done the way they are. Written to be readable
> if you're strong in React but newer to TypeScript, Next.js's App Router, and
> backend concepts (auth, OAuth, databases). Jargon is explained inline and in
> the [Glossary](#18-glossary) at the end.

---

## Table of contents

1. [What LifeOS is](#1-what-lifeos-is)
2. [Tech stack at a glance](#2-tech-stack-at-a-glance)
3. [The mental model: how this Next.js app actually runs](#3-the-mental-model-how-this-nextjs-app-actually-runs)
4. [Directory & file map](#4-directory--file-map)
5. [The request & auth lifecycle](#5-the-request--auth-lifecycle)
6. [Authentication deep-dive (Supabase)](#6-authentication-deep-dive-supabase)
7. [The data model (database)](#7-the-data-model-database)
8. [The Dashboard component — the hub](#8-the-dashboard-component--the-hub)
9. [Feature-by-feature breakdown](#9-feature-by-feature-breakdown)
10. [Integrations & OAuth (Microsoft + Google)](#10-integrations--oauth-microsoft--google)
11. [The theming system](#11-the-theming-system)
12. [Where state lives (persistence map)](#12-where-state-lives-persistence-map)
13. [Notable patterns & techniques](#13-notable-patterns--techniques)
14. [Environment variables](#14-environment-variables)
15. [Gotchas, limitations & tech debt](#15-gotchas-limitations--tech-debt)
16. [Suggested next steps](#16-suggested-next-steps)
17. [Quick reference](#17-quick-reference)
18. [Glossary](#18-glossary)

---

## 1. What LifeOS is

LifeOS is a **personal dashboard** — a single-page "operating system for your
life" gated behind a login. Once signed in, you get one screen with several
widgets and a top-nav that switches between five views:

| Screen | What it does |
| --- | --- |
| **Home** | The dashboard grid: profile, to-do widget, quick note, live clock, habits, calendar, nutrition, activity heatmap |
| **Tasks** | Full task manager backed by **Microsoft To Do** |
| **Habits** | Habit tracker with per-day-of-week scheduling and streaks |
| **Pomodoro** | Focus timer (focus + break phases) with a session-history timeline |
| **Settings** | Account name, dark/glass appearance toggles, connect/disconnect integrations |

The visual design (the "Sage" look — warm paper background, sage-green accents,
serif headings) was first built as a plain HTML/CSS/JS prototype. This repo is
the **real React rewrite** of that prototype, with authentication and real
data wired in.

**Important nuance:** not every widget is "real" yet. Tasks, habits, the
pomodoro timer, profile name, and the calendar are backed by real data
(database or third-party APIs). The **Nutrition card, the Activity heatmap, and
the Quick Note are still placeholder/mock UI** — they look functional but aren't
persisted anywhere. See the [persistence map](#12-where-state-lives-persistence-map).

---

## 2. Tech stack at a glance

| Layer | Technology | Notes |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, Turbopack) | Note: this project pins a newer Next than your training data — see `AGENTS.md`. APIs/conventions can differ. |
| UI library | **React 19** | Server + Client Components. |
| Language | **TypeScript 5** (`strict: true`) | Path alias `@/*` → `src/*` (see `tsconfig.json`). |
| Auth + DB | **Supabase** | Postgres database + hosted auth, accessed via `@supabase/ssr` and `@supabase/supabase-js`. |
| 3rd-party data | **Microsoft Graph** (To Do) and **Google Calendar** | Connected per-user via OAuth 2.0. |
| Styling | Plain **CSS** | One global stylesheet (`globals.css`) + one CSS Module for auth pages. No Tailwind, no CSS-in-JS library. |
| Hosting | **Vercel** (intended) | Env vars configured in the Vercel dashboard. |

There is **no state-management library** (no Redux/Zustand), **no data-fetching
library** (no React Query), and **no component library** (no MUI/shadcn).
Everything is built from React primitives, hand-written CSS, and Next.js's
built-in server features. That's worth internalizing: the app is deliberately
"low-dependency."

---

## 3. The mental model: how this Next.js app actually runs

This is the single most important section if Next.js's App Router is new to you.
Coming from plain React (e.g. Vite + React Router), the biggest shift is:
**a lot of your code runs on the server, not in the browser.** There are three
distinct "places" code runs.

### 3a. Server Components (the default)

In the App Router, every file under `src/app/` is a **Server Component by
default**. That means it runs **on the server**, renders to HTML, and ships that
HTML to the browser. It never runs in the browser and never ships its JS to the
client. This is why a server component can do things a normal React component
can't — like `await` a database call directly in the function body:

```tsx
// src/app/page.tsx — a Server Component
export default async function Home() {        // <- note: async!
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();  // talks to Supabase on the server
  if (!user) redirect("/login");
  // ...fetches data, then renders <Dashboard /> with that data as props
}
```

You can't use `useState`, `useEffect`, `onClick`, or any browser API in a server
component — there's no browser there.

### 3b. Client Components (`"use client"`)

A file that starts with the `"use client"` directive is a **Client Component**.
It still gets server-rendered once (for fast first paint), but then it
**"hydrates"** and runs in the browser like the React you already know — with
state, effects, and event handlers.

`src/components/Dashboard.tsx` is the big client component. The entire
interactive dashboard is client-side. The pattern in this app is:

```
Server Component (page.tsx)  ->  fetches data, checks auth
        │  passes data down as props
        ▼
Client Component (Dashboard.tsx)  ->  all the interactivity
```

This is a very common and idiomatic App Router pattern: **a thin async server
component at the route that does auth + data loading, handing a fat client
component the initial data as props.**

### 3c. Server Actions (`"use server"`)

A **Server Action** is a function that lives on the server but can be *called
directly from client code* as if it were a normal async function. Next.js turns
the call into an RPC (a behind-the-scenes `fetch` to the server) automatically.
You'll see `"use server"` at the top of several files:

```ts
// src/lib/data/habits.ts
"use server";
export async function addHabit(name: string, frequency: number[]) {
  const supabase = await createClient();   // runs on the server
  // ...inserts a row, returns the new habit
}
```

And in the client component you just `await` it:

```tsx
const created = await addHabitAction(trimmed, habitDraftFreq);  // looks local, runs on server
setHabits((prev) => [...prev, created]);
```

Server Actions are how this app does all its **mutations** (create/update/delete)
without hand-writing API route handlers. They're also used for the auth flow
(`signIn`/`signUp`/`signOut`) where they're attached directly to `<form action={...}>`.

> **Why this matters:** secrets (database credentials, OAuth client secrets,
> refresh tokens) only ever exist on the server. The browser never sees them.
> Server Components and Server Actions are the app's secure boundary.

### 3d. The Proxy (formerly "middleware")

One file, `src/proxy.ts`, runs **before every matching request reaches a page.**
In older Next.js this file was called `middleware.ts`; Next 16 renames the
concept to a "Proxy" (the exported function is `proxy`). Its job here is to
refresh the Supabase session cookie and redirect signed-out users to `/login`.
Think of it as a gatekeeper that every request passes through first. Details in
[§5](#5-the-request--auth-lifecycle).

### 3e. Route Handlers

Files named `route.ts` (e.g. `src/app/auth/callback/route.ts`) are **Route
Handlers** — the App Router's version of API endpoints. They export functions
named after HTTP verbs (`GET`, `POST`) and return `Response` objects. This app
uses them for the OAuth callback URLs that Google/Microsoft/Supabase redirect
back to.

**Summary of the four server-side building blocks:**

| Construct | File signal | Used here for |
| --- | --- | --- |
| Server Component | (default in `app/`) | The route pages: auth check + initial data load |
| Client Component | `"use client"` | `Dashboard.tsx` — all interactivity |
| Server Action | `"use server"` | Mutations + auth form actions |
| Route Handler | `route.ts` | OAuth callback endpoints |
| Proxy/Middleware | `src/proxy.ts` | Session refresh + redirect gatekeeping |

---

## 4. Directory & file map

```
The Dashboard Project/
├─ AGENTS.md / CLAUDE.md       # Instructions (note: pinned Next version differs from docs)
├─ README.md                   # Setup + deploy guide
├─ next.config.ts              # Next.js config (currently empty/default)
├─ tsconfig.json               # TS config; defines the @/* -> src/* path alias
├─ eslint.config.mjs           # Lint config (extends eslint-config-next)
├─ .env.local.example          # Template for required environment variables
│
├─ supabase/migrations/        # SQL files defining the database schema + security
│  ├─ 0001_habits.sql
│  ├─ 0002_google_tokens.sql
│  ├─ 0003_pomo_sessions.sql
│  └─ 0004_profiles.sql
│
└─ src/
   ├─ proxy.ts                 # Runs before every request (session refresh + auth redirect)
   │
   ├─ app/                     # App Router: routes, layouts, server-side endpoints
   │  ├─ layout.tsx            # Root HTML shell, fonts, no-flash theme script
   │  ├─ page.tsx              # "/" — the dashboard route (server component, auth-gated)
   │  ├─ loading.tsx           # Instant loading screen streamed while page.tsx loads
   │  ├─ globals.css           # ALL dashboard styling + design tokens (~840 lines)
   │  ├─ auth.module.css       # Scoped styling for the login/signup pages
   │  ├─ login/page.tsx        # Login screen (server component, renders a form)
   │  ├─ signup/page.tsx       # Signup screen
   │  └─ auth/
   │     ├─ actions.ts         # Server Actions: signIn / signUp / signOut
   │     ├─ callback/route.ts  # Supabase email-confirmation redirect handler
   │     ├─ google/route.ts            # Kicks off Google OAuth
   │     ├─ google/callback/route.ts   # Google OAuth redirect target -> stores token
   │     ├─ microsoft/route.ts         # Kicks off Microsoft OAuth
   │     └─ microsoft/callback/route.ts# Microsoft OAuth redirect target -> stores token
   │
   ├─ components/
   │  └─ Dashboard.tsx         # THE app UI — 1.6k-line client component, all 5 screens
   │
   └─ lib/                     # Non-UI logic, grouped by concern
      ├─ supabase/
      │  ├─ client.ts          # Browser Supabase client
      │  ├─ server.ts          # Server Supabase client (reads/writes cookies)
      │  └─ middleware.ts      # The session-refresh logic the proxy calls
      ├─ data/
      │  ├─ habits.ts          # Server Actions for habits CRUD + completions
      │  └─ pomoSessions.ts    # Server Actions for pomodoro history
      ├─ google/
      │  ├─ getAccessToken.ts  # Refresh-token -> access-token exchange
      │  └─ fetchEvents.ts     # Fetch a day of Google Calendar events
      ├─ microsoft/
      │  ├─ getAccessToken.ts  # Refresh-token -> access-token exchange (rotates token)
      │  ├─ fetchTasks.ts      # Read tasks from the "LifeOS" To Do list
      │  └─ syncTasks.ts       # Push local task changes to Microsoft To Do
      ├─ settings/actions.ts   # Server Actions: update name, disconnect integrations
      └─ pomodoro.ts           # Pure helpers for (de)serializing timer state to a cookie
```

The organizing principle: **`app/` is routes and server endpoints, `components/`
is UI, `lib/` is everything else (data access, integrations, helpers).** Within
`lib/`, code is grouped by *concern* (supabase, google, microsoft, data...).

---

## 5. The request & auth lifecycle

Here's what happens, in order, when a signed-out user visits the site and a
signed-in user loads the dashboard.

### Signed-out user hits `/`

```
Browser: GET /
   │
   ▼
src/proxy.ts  ──calls──►  lib/supabase/middleware.ts (updateSession)
   │   - reads auth cookies from the request
   │   - calls supabase.auth.getUser()  -> no user
   │   - path "/" is not in PUBLIC_PATHS
   │   - returns a redirect to /login
   ▼
Browser: 302 -> /login  (renders login/page.tsx)
```

`PUBLIC_PATHS` (in `middleware.ts`) is `["/login", "/signup", "/auth/callback"]`
— the only routes a signed-out user may see. Everything else redirects to login.
There's also the reverse guard: a **signed-in** user who navigates to `/login`
or `/signup` is bounced to `/`.

### Signed-in user hits `/`

```
Browser: GET /
   │
   ▼
src/proxy.ts -> updateSession()  -> refreshes session cookie, user exists, allow through
   │
   ▼
src/app/loading.tsx  (streamed INSTANTLY — see §13 "no-flash")
   │   meanwhile, on the server:
   ▼
src/app/page.tsx (async Server Component)
   │   - supabase.auth.getUser()  -> confirms the user
   │   - Promise.all([...]) fires 5 independent reads CONCURRENTLY:
   │       • microsoft_tokens row?   (is MS connected?)
   │       • google_tokens row?      (is Google connected?)
   │       • profiles row            (the display name)
   │       • getHabits(user.id)      (habits + today's completions)
   │       • cookies()               (to seed the pomodoro timer)
   │   - parses the pomodoro cookie into initial timer state
   ▼
Renders <Dashboard ... /> with all of that as props
   │
   ▼
Browser hydrates Dashboard.tsx -> fully interactive
```

Two performance choices are worth calling out, because they're good habits:

- **The proxy calls `getUser()` and so does `page.tsx`.** That's intentional —
  the proxy's job is session *refresh* on every request; the page's job is the
  authoritative gate before rendering. (`getUser()` validates the token with
  Supabase's servers, unlike `getSession()` which just reads the cookie.)
- **`page.tsx` batches its reads with `Promise.all`.** These five lookups don't
  depend on each other, so running them concurrently collapses five sequential
  network round-trips into one wall-clock wait.

---

## 6. Authentication deep-dive (Supabase)

### Why three different Supabase clients?

Because Supabase auth here is **cookie-based**, and cookies are read/written
differently depending on *where* the code runs. There are three helper factories,
each for a different runtime:

| File | Runtime | How it touches cookies |
| --- | --- | --- |
| `lib/supabase/client.ts` | Browser (Client Components) | `createBrowserClient` — uses `document.cookie` automatically |
| `lib/supabase/server.ts` | Server Components & Actions | `createServerClient` — reads/writes via Next's `cookies()` |
| `lib/supabase/middleware.ts` | The Proxy | `createServerClient` — reads from the request, writes to the response |

They all point at the same Supabase project (same URL + anon key) — they just
differ in their **cookie plumbing**. This three-client split is the standard
`@supabase/ssr` pattern; if you ever see "Auth session missing" bugs, it's
almost always a cookie-plumbing mismatch between these.

### Is it safe that the anon key is in `NEXT_PUBLIC_*` (i.e. public)?

Yes — and this trips up a lot of people. The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is
**designed** to be shipped to the browser. It identifies your project but grants
no privileges on its own. The actual security comes from **Row Level Security**
(see [§7](#7-the-data-model-database)): the database itself refuses to return
rows that don't belong to the logged-in user. So even though anyone can see the
anon key, they can only ever read/write *their own* data.

### The auth flows

**Sign up** (`signUp` in `app/auth/actions.ts`):
1. User submits the signup form (name, email, password).
2. The Server Action calls `supabase.auth.signUp(...)`, passing
   `emailRedirectTo` (the confirmation link target) and stashing the full name
   in user metadata (`data: { full_name }`).
3. Supabase emails a confirmation link. The user is redirected to `/login` with
   a "check your email" notice.
4. When they click the email link, they land on
   `app/auth/callback/route.ts`, which calls `exchangeCodeForSession(code)` to
   turn the one-time code into a real session, then redirects to `/`.

**Sign in** (`signIn`): calls `signInWithPassword`, then `revalidatePath("/",
"layout")` (clears cached server render so the dashboard re-renders fresh for the
now-authenticated user) and redirects to `/`.

**Sign out** (`signOut`): `supabase.auth.signOut()`, revalidate, redirect to
`/login`.

**How the name becomes a profile row:** the `full_name` is saved into Supabase
auth metadata at signup. A **database trigger** (`on_auth_user_created`, defined
in `0004_profiles.sql`) automatically inserts a matching row into the `profiles`
table whenever a new auth user is created, copying that name across. So the app
never has to manually create profile rows — the database does it. (The migration
also backfills profiles for any users that existed before the trigger.)

### Login/signup pages are Server Components

Notice `login/page.tsx` and `signup/page.tsx` are **async server components with
no `"use client"`.** They render plain `<form action={signIn}>` — the form posts
directly to a Server Action. No client-side JavaScript is needed for the form to
work, and errors are surfaced by reading `searchParams` (the action redirects
back with `?error=...` on failure). This is a clean, progressive-enhancement-
friendly pattern.

---

## 7. The data model (database)

The schema lives as four SQL **migration** files in `supabase/migrations/`. A
migration is just a versioned SQL script you run against the database to evolve
its structure. You apply them in numbered order. There are five tables:

| Table | Key columns | Purpose |
| --- | --- | --- |
| `habits` | `id`, `user_id`, `name`, `strk` (streak), `frequency` (int[] of weekday numbers), `created_at` | One row per habit |
| `habit_completions` | `id`, `habit_id`, `user_id`, `date`, `unique(habit_id, date)` | One row per habit per day it was completed |
| `google_tokens` | `user_id` (PK), `refresh_token`, `updated_at` | The user's Google Calendar refresh token |
| `microsoft_tokens` | `user_id` (PK), `refresh_token`, `updated_at` | The user's Microsoft To Do refresh token |
| `pomo_sessions` | `id`, `user_id`, `task_name`, `completed_at`, `duration` (seconds), `created_at` | One row per completed focus session |
| `profiles` | `id` (PK = auth user id), `full_name`, timestamps | Display name, auto-created by a trigger |

> Note: `microsoft_tokens` is referenced by the code and read in `page.tsx`, but
> there's no `*_microsoft_tokens.sql` migration file in the repo — it was likely
> created directly in the Supabase dashboard or in an untracked migration. Worth
> knowing if you ever rebuild the DB from scratch.

### Row Level Security (RLS) — the heart of the security model

Every table has this pattern (shown here for habits):

```sql
alter table public.habits enable row level security;

create policy "Users can manage their own habits"
  on public.habits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

**What this means:** once RLS is enabled, the database returns *no rows by
default.* The policy then says "a row is visible/editable only if its `user_id`
equals the currently-authenticated user's id (`auth.uid()`)." `using` controls
which rows you can **read/affect**; `with check` controls which rows you're
allowed to **write**. Supabase knows who `auth.uid()` is from the session cookie.

The practical upshot: the app's data-access code (e.g. `getHabits`) often doesn't
*need* to filter by user — the database enforces it regardless. You'll see a
comment to exactly this effect in `lib/data/habits.ts`. Passing `userId` around
is a *performance* optimization (avoids a redundant `getUser()` call), **not** a
security boundary. RLS is the security boundary.

### What's persisted vs. what's mock

| Persisted to the database | Mock / not persisted |
| --- | --- |
| Habits + daily completions + streaks | Nutrition card (hard-coded calories/macros/water) |
| Pomodoro sessions (history) | Activity heatmap (random values, regenerated each mount) |
| Profile name | Quick Note (local state with default text) |
| OAuth refresh tokens (Google/Microsoft) | Pinned-task flags (localStorage only — see §9) |
| Tasks (in Microsoft To Do, not Supabase) | Pomodoro *settings* like duration (cookie only) |

---

## 8. The Dashboard component — the hub

`src/components/Dashboard.tsx` (~1,630 lines) is where essentially all the
interactivity lives. It's one big client component. Don't be intimidated by the
length — it's long because it inlines five full screens and many SVG icons, not
because it's deeply complex.

### How it receives data

The server component (`page.tsx`) hands it everything it needs as props:

```tsx
<Dashboard
  email={user.email}
  name={profileRow?.full_name}
  microsoftConnected={!!tokenRow}     // boolean: does a microsoft_tokens row exist?
  googleConnected={!!googleTokenRow}  // boolean: does a google_tokens row exist?
  initialHabits={habits}              // pre-loaded so the first paint has data
  initialPomo={initialPomo}           // timer state parsed from the cookie
/>
```

The `initial*` props are a deliberate pattern: the server pre-loads data so the
**first render already shows real content** (no spinner flash), and the client
takes over from there.

### How screen switching works (shallow routing)

The five screens are selected by a `screen` query param (`?screen=tasks`, etc.),
read via `useSearchParams()`. But switching screens does **not** use
`router.push()`. Instead it calls `window.history.pushState()` directly:

```tsx
function setScreen(s) {
  const params = new URLSearchParams(searchParams.toString());
  if (s === "home") params.delete("screen");
  else params.set("screen", s);
  window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
}
```

**Why?** `page.tsx` is a dynamic, auth-checked server component. A real
`router.push()` would re-run the server route — re-fetching tokens, habits, etc.
— on *every tab click*. Using `pushState` updates the URL (and `useSearchParams`
stays in sync with it) **without any server round-trip**, so tab switches are
instant. This is a clever, deliberate optimization. The trade-off: the screens
are all mounted in one component rather than being separate routes.

### State inventory

The component holds a lot of `useState`. Grouped by feature:

- **Profile:** `profileName`, `nameDraft`, `nameSaved`
- **Appearance:** `darkMode`, `glass` (mirrored to `localStorage` + a `data-*`
  attribute on `<html>`)
- **Clock:** `now` (a `Date`, ticked every second by an interval)
- **Tasks:** `tasks`, plus add-form state for both the home widget and the Tasks
  screen (`adding`/`draft` and `tasksAdding`/`tasksDraft`), and Microsoft sync
  status (`syncing`, `syncStatus`)
- **Quick note:** `note`, `capture`
- **Habits:** `habits`, plus the add-habit form (`habitAdding`, `habitDraft`,
  `habitDraftFreq`)
- **Calendar:** `calDate`, `calEvents`, `calState`, plus two `useRef` caches
  (`calCache`, `calFetching`)
- **Heatmap:** `heat`
- **Pomodoro:** a dozen pieces — `pomoMinutes`, `pomoBreakMinutes`, `pomoPhase`,
  `pomoRemain`, `pomoRunning`, `pomoTaskName`, `pomoTaskChosen`, `pomoHistory`,
  plus modal/settings toggles and a timer `useRef`.

The render is a big conditional: a top bar (always shown) followed by
`screen === "home" ? (...) : screen === "tasks" ? (...) : null`, and then
separate `screen === "habits" && (...)`, `"pomodoro"`, `"settings"` blocks.

---

## 9. Feature-by-feature breakdown

### Tasks (home widget + Tasks screen) — backed by Microsoft To Do

Tasks are **not stored in Supabase**. They live in the user's **Microsoft To Do**
account, in a list named `"LifeOS"`. The flow:

- **On mount**, if Microsoft is connected, `fetchMicrosoftTasks()` pulls the
  current tasks from the `LifeOS` list into local `tasks` state.
- **Every change** to `tasks` (add/toggle/delete) triggers an effect that calls
  `syncTasksToMicrosoft(tasks)` — pushing the changes back. A `useTransition`
  drives the "Syncing…/Synced!/Sync failed" status pill. An `isFirstRender` ref
  skips syncing on the very first load (so the initial fetch doesn't immediately
  echo back).
- **"Pinned" tasks** are the ones shown in the home to-do widget. Microsoft To
  Do has no "pinned" concept, so the starred/pinned flag **can't round-trip
  through the sync**. It's tracked **locally in `localStorage`, keyed by task
  name** (`PINNED_KEY = "pinnedTaskNames"`). Tasks added from the *home widget*
  are auto-pinned; tasks added from the *Tasks screen* are not.
- The Tasks screen splits tasks into "Pinned to To-Do" and "Other" sections,
  with pin/unpin and delete controls. Deleting also calls
  `deleteTaskFromMicrosoft(msId)`.

Sync matching is **by task title**: `syncTasksToMicrosoft` fetches existing
remote tasks, builds a `Map` keyed by title, then decides what to create vs.
what to update. (Implication: two tasks with the same name, or renaming a task,
can confuse the matcher — see [§15](#15-gotchas-limitations--tech-debt).)

### Habits — backed by Supabase

Habits persist in the `habits` table; daily completion is tracked in
`habit_completions`. Logic lives in `lib/data/habits.ts` (all Server Actions).

- **Frequency** is an `int[]` of weekday numbers (0 = Sunday … 6 = Saturday). An
  **empty array means "every day."** The home screen only shows habits scheduled
  for *today's* weekday; the Habits screen shows all of them with a day-letter
  picker (`S M T W T F S`) to edit the schedule.
- **Streaks** (`strk`) are a simple counter on the habit row. Toggling a habit
  for today inserts/deletes a `habit_completions` row *and* bumps the streak
  `+1`/`-1`. (It's a naive counter, not a true "consecutive days" computation —
  see [§15](#15-gotchas-limitations--tech-debt).)
- **Optimistic UI:** toggling updates local state immediately, *then* fires the
  Server Action in the background (the result isn't awaited before the UI
  changes). Same for add/delete/frequency edits. This makes the UI feel instant.

### Pomodoro — backed by Supabase (history) + a cookie (live timer)

A focus timer with two phases: `focus` then `break`. When a focus phase
completes, it auto-starts a break; when the break completes, it resets to focus.

- **Live timer state** (current minutes, phase, remaining seconds, running?,
  chosen task) is persisted to a **cookie** named `pomodoro` on every change.
  Helpers in `lib/pomodoro.ts` (`serializePomoState` / `parsePomoState`) handle
  this. The clever bit: a *running* timer is stored as an **absolute end
  timestamp** (`endsAt`), so when you refresh or reopen the tab, the remaining
  time is recomputed against the real clock rather than frozen. The server reads
  this cookie in `page.tsx` and seeds the initial render, so a refresh shows the
  *continued* time with no flash of the default 25:00. (This is why a cookie is
  used instead of `localStorage` — only cookies are visible to the server.)
- **Session history** persists in `pomo_sessions` (loaded for the last 14 days on
  mount via `getPomoSessions`). Each completed focus session records the task
  name, completion time, and duration.
- The bottom of the Pomodoro screen renders a **per-day timeline** (a 6am→midnight
  track) of past sessions, color-coded by task, with a legend. The timer settings
  panel lets you pick focus/break durations (presets + a custom 1–240 input).

### Calendar — backed by Google Calendar

A day-view calendar (home screen, center column) reading the user's **primary
Google Calendar**.

- `fetchDayEvents(dateISO)` (a Server Action in `lib/google/fetchEvents.ts`) pulls
  one day's events via the Google Calendar API, splitting them into all-day and
  timed events, and computing minute offsets for timeline positioning. Multi-day
  events are clamped to the visible day.
- The UI renders a 07:00–22:00 timeline (stretched if events fall outside), a
  "now" line on today, a week strip (Mon–Sun) for quick navigation, and ‹ › / Today
  controls.
- **Caching + prefetch:** results are cached per-day in a `useRef` `Map`, and an
  in-flight `Set` dedupes concurrent fetches of the same day. When you view a day,
  the component **prefetches the whole visible week plus the neighbors and today**,
  so navigating feels instant. Cached days render immediately and refresh quietly
  in the background ("stale-while-revalidate"). A `stale` flag in the effect's
  cleanup prevents out-of-order responses from overwriting newer ones.

### Nutrition card — **mock**

Hard-coded calories (1,584 / 2,200 kcal), macro bars (protein/carbs/fat), and a
6/8 water-glasses widget. Purely presentational; nothing is wired to data.

### Activity heatmap — **mock**

A 15-weeks × 7-days grid. Values are **random**, generated client-side in an
effect (to avoid a server/client hydration mismatch, since `Math.random()` would
differ between the two). Regenerates every mount — not real activity data.

### Profile & name

The avatar shows initials derived from the display name; the display name is the
saved profile name, falling back to a name *derived from the email* (via
`nameFromEmail`, which title-cases the local part and drops purely-numeric
segments) for older accounts. Editing the name (Settings → Account) calls
`updateProfileName` (Server Action), updates local state optimistically, and
shows a transient "Saved" confirmation.

### Quick Note — **local only**

A single note string with a default value, plus a "capture a thought" input that
replaces the note on Enter. Not persisted — refreshing resets it.

### Settings screen

Three sections: **Account** (editable name, read-only email), **Appearance**
(dark-mode + glass-mode switches), and **Integrations** (connect/disconnect
Microsoft and Google). Disconnecting deletes the relevant `*_tokens` row (via a
Server Action) and calls `router.refresh()` to re-pull server state.

---

## 10. Integrations & OAuth (Microsoft + Google)

Both integrations use the **OAuth 2.0 Authorization Code flow**. If OAuth is new
to you, the one-sentence version: *the user is sent to Google/Microsoft to log in
and grant permission; those services redirect back to our app with a one-time
code; our server swaps that code for tokens.* You get two tokens:

- an **access token** (short-lived, used to call the API), and
- a **refresh token** (long-lived, used to get new access tokens later).

We store only the **refresh token** (in `google_tokens` / `microsoft_tokens`),
and exchange it for a fresh access token whenever we need to call the API.

### The flow (Google example — Microsoft is structurally identical)

```
User clicks "Connect Google Calendar"  ->  GET /auth/google
   │  (app/auth/google/route.ts builds the Google consent URL and redirects)
   ▼
Google login + consent screen
   │  Google redirects back with ?code=...
   ▼
GET /auth/google/callback  (app/auth/google/callback/route.ts)
   │  - POSTs the code to Google's token endpoint
   │  - gets back a refresh_token
   │  - upserts it into google_tokens for the logged-in user
   ▼
Redirect to /?google_connected=true
```

### Reading data later

`lib/google/getAccessToken.ts` and `lib/microsoft/getAccessToken.ts` each:
1. Look up the stored refresh token for the current user.
2. POST it to the provider's token endpoint to get a fresh **access token**.
3. Return that access token, which the fetch helpers (`fetchEvents`,
   `fetchTasks`, `syncTasks`) put in an `Authorization: Bearer ...` header.

### One real difference between the two providers

**Microsoft rotates refresh tokens** — each time you exchange one, you get a *new*
refresh token and must save it, or the old one stops working. The Microsoft
helper does exactly that (`update(...refresh_token...)` after each exchange).
**Google does not rotate** refresh tokens, so the Google helper has nothing to
re-save. This is a genuine provider-specific gotcha that the code handles
correctly, and the comments call it out.

### Scopes requested

- **Google:** `https://www.googleapis.com/auth/calendar.readonly` (read-only
  calendar) with `access_type=offline` + `prompt=consent` (required to actually
  receive a refresh token).
- **Microsoft:** `Tasks.ReadWrite offline_access` (read/write To Do; `offline_access`
  is what grants a refresh token). Uses the `consumers` authority (personal
  Microsoft accounts).

---

## 11. The theming system

All styling is plain CSS in `app/globals.css` (plus `auth.module.css` for the
auth pages). There's no Tailwind or CSS-in-JS.

### Design tokens via CSS custom properties

The `:root` block defines the whole palette as CSS variables — and notably uses
the **`oklch()` color space** (`oklch(lightness chroma hue)`) rather than hex.
oklch is perceptually uniform, which makes it easy to derive consistent
tints/shades by nudging lightness. Tokens include `--paper`, `--card`, `--ink*`
(text shades), `--sage*` (the green accent family), `--rose*`, plus radii,
shadow, and the three font families (Playfair Display serif, Hanken Grotesk sans,
JetBrains Mono).

### How modes are switched: `data-*` attributes on `<html>`

Themes are toggled by setting attributes on the root `<html>` element, which
re-point the CSS variables:

| Attribute | Values | Effect | Wired to a control? |
| --- | --- | --- | --- |
| `data-mood` | `Charcoal` | Dark mode (overrides the palette) | ✅ Settings → Dark mode |
| `data-glass` | `on` | Frosted glassmorphism on cards | ✅ Settings → Glass mode |
| `data-accent` | `Indigo` / `Clay` / `Plum` | Alternate accent colors | ❌ defined in CSS, no UI |
| `data-voice` | `Modern` / `Mono` | Alternate typography | ❌ defined in CSS, no UI |

`data-accent` and `data-voice` are **vestigial** — they're carried over from the
original prototype's "tweaks panel" and still have full CSS support, but
nothing in the current React app sets them. They're latent features waiting
for a UI, not dead weight you need to fear.

### The no-flash theme script (clever bit)

Dark/glass preferences are stored in `localStorage`. But `localStorage` isn't
readable on the server, so a naive approach would render light-mode HTML first,
then flip to dark after hydration — a jarring flash. To avoid this, `layout.tsx`
inlines a tiny **blocking `<script>` in `<head>`** that reads `localStorage` and
sets the `data-mood` / `data-glass` attributes **before the page paints**:

```js
(function(){
  var d=localStorage.getItem('darkMode');
  if(d==='true')document.documentElement.setAttribute('data-mood','Charcoal');
  var g=localStorage.getItem('glass');
  if(g==='true')document.documentElement.setAttribute('data-glass','on');
})();
```

The `Dashboard` component then **adopts** that pre-applied value on mount
(starting its `darkMode`/`glass` state at `false` to match the server render,
then reading the real value from the DOM in the first effect) so it never
clobbers the attribute or causes a hydration mismatch. The `loading.tsx` screen
exists partly to flush this `<head>` script instantly. This is a well-known
"theme flash" solution and it's implemented carefully here.

---

## 12. Where state lives (persistence map)

This table is the fastest way to understand the app's data flow. "Survives
refresh?" tells you where the source of truth is.

| Feature | Source of truth | Survives refresh? | Synced across devices? |
| --- | --- | --- | --- |
| Auth session | Supabase (cookie) | ✅ | ✅ |
| Habits / completions / streaks | Supabase `habits`, `habit_completions` | ✅ | ✅ |
| Pomodoro history | Supabase `pomo_sessions` | ✅ | ✅ |
| Profile name | Supabase `profiles` | ✅ | ✅ |
| Tasks | **Microsoft To Do** (`LifeOS` list) | ✅ | ✅ (via Microsoft) |
| OAuth refresh tokens | Supabase `*_tokens` | ✅ | ✅ |
| Calendar events | **Google Calendar** (read live) | ✅ (it's Google's) | ✅ |
| Pomodoro live timer + settings | Browser **cookie** (`pomodoro`) | ✅ (same browser) | ❌ |
| Dark / glass mode | Browser **localStorage** | ✅ (same browser) | ❌ |
| Pinned-task flags | Browser **localStorage** (by task name) | ✅ (same browser) | ❌ |
| Quick Note | React state (in-memory) | ❌ | ❌ |
| Nutrition card | Hard-coded | ❌ (always the same) | — |
| Activity heatmap | `Math.random()` each mount | ❌ (changes every load) | — |

---

## 13. Notable patterns & techniques

A grab-bag of techniques used here that are worth recognizing and reusing:

- **Server-loads-then-client-takes-over.** The route server component does auth
  + initial data fetch and passes `initial*` props to a client component. First
  paint has real content; no loading spinner for the primary data.
- **Concurrent reads with `Promise.all`.** Independent lookups in `page.tsx` run
  in parallel instead of stacking round-trips.
- **Optimistic UI everywhere.** Habit toggles, task edits, name saves update
  local state *first*, then fire the Server Action in the background. The UI
  never waits on the network for the common case.
- **Stale-while-revalidate caching** (calendar): show cached data instantly,
  refresh in the background, dedupe in-flight requests, and guard against
  out-of-order responses with a `stale` flag in the effect cleanup.
- **Cookie-seeded SSR** (pomodoro): persist to a cookie so the *server* can read
  it and render continued state with no flash. Anchor running timers to an
  absolute timestamp so elapsed time is correct after a refresh.
- **Shallow routing via `pushState`** to switch views without re-running the
  server route.
- **No-flash theming** via a blocking head script (see [§11](#11-the-theming-system)).
- **Hydration-mismatch avoidance.** Anything non-deterministic between server and
  client (the live clock `now`, the random heatmap) starts as `null`/empty and is
  populated in a `useEffect`, so the server and first client render agree.
- **`useTransition` for non-blocking background work** (the Microsoft sync status
  pill).
- **`useRef` as instance storage** for things that shouldn't trigger re-renders:
  the calendar cache, the in-flight set, the pomodoro interval handle, and
  "first render" guards (`isFirstRender`, `darkMounted`, `pomoMounted`).

---

## 14. Environment variables

Copy `.env.local.example` to `.env.local` and fill these in. Variables prefixed
`NEXT_PUBLIC_` are exposed to the browser; the rest are **server-only secrets**.

| Variable | Public? | Used by | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | all Supabase clients | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | all Supabase clients | Public anon key (safe to expose; RLS protects data) |
| `NEXT_PUBLIC_SITE_URL` | ✅ | auth + OAuth redirects | Base URL for building redirect links |
| `GOOGLE_CLIENT_ID` | ❌ | Google OAuth | OAuth app id |
| `GOOGLE_CLIENT_SECRET` | ❌ | Google OAuth | OAuth app secret |
| `MICROSOFT_CLIENT_ID` | ❌ | Microsoft OAuth | OAuth app id |
| `MICROSOFT_CLIENT_SECRET` | ❌ | Microsoft OAuth | OAuth app secret |

> Only the three `NEXT_PUBLIC_*` vars are in `.env.local.example`. The four
> OAuth secrets are required for the Google/Microsoft features but aren't listed
> in the example file — add them yourself (and to Vercel's env settings).

---

## 15. Gotchas, limitations & tech debt

An honest list of things to be aware of before you start changing code. None of
these are catastrophic; they're the normal rough edges of an app in active
development.

1. **`NEXT_PUBLIC_SITE_URL` trailing-slash inconsistency (latent bug).** The
   Google/Microsoft OAuth routes build URLs by concatenating *without* a slash —
   e.g. `` `${SITE_URL}auth/google/callback` `` and `` `${SITE_URL}login` `` — so
   they require `SITE_URL` to **end with `/`** (e.g. `http://localhost:3000/`).
   But the Supabase signup action builds `` `${SITE_URL}/auth/callback` `` (leading
   slash) and `.env.local.example` ships `http://localhost:3000` (no slash). The
   two conventions conflict: with the example value, Google/Microsoft connect
   URLs come out malformed (`localhost:3000auth/...`). Pick a convention and make
   both sides agree (simplest: normalize the base URL in one helper).
2. **Mock data presented as real.** Nutrition and the Activity heatmap look like
   features but are static/random. The Quick Note isn't persisted. Don't mistake
   them for working data flows.
3. **Vestigial theme CSS.** `data-accent` and `data-voice` have full CSS but no
   UI control. Either wire them into Settings or treat them as dormant.
4. **Streaks are a naive counter.** `strk` just increments/decrements on toggle;
   it isn't a real "consecutive days" calculation and can drift from reality
   (e.g. it doesn't reset when you miss a day). The `habit_completions` table has
   the raw data to compute true streaks if you want to.
5. **Microsoft task sync matches by title.** Renaming a task or having two tasks
   with the same name can confuse the create-vs-update logic in `syncTasks.ts`.
   There's no stable id mapping for *new* tasks until the next fetch.
6. **Pinned flags are local + name-keyed.** Pins live only in this browser's
   `localStorage`, keyed by task name — they don't sync across devices and break
   if a task is renamed.
7. **Debug `console.log`s left in `syncTasks.ts`.** Several logging statements
   (list id, existing tasks, etc.) are still present and would be worth removing.
8. **Heatmap re-randomizes every mount**, so it visibly changes on each load —
   fine for a mock, surprising if you forget it's fake.
9. **`microsoft_tokens` has no tracked migration.** The table is used in code but
   there's no SQL file for it in `supabase/migrations/`. Re-creating the DB from
   the migrations alone would miss it.
10. **Everything interactive is one 1.6k-line component.** It works and is
    reasonably organized by section comments, but there's a natural refactor here
    — splitting each screen (and the pomodoro/calendar logic) into its own
    component/hook would make it far easier to navigate.

---

## 16. Suggested next steps

If you're looking to extend the app, in rough order of value-to-effort:

- **Fix the `SITE_URL` slash inconsistency** (#1 above) — small change, removes a
  real footgun.
- **Make the Quick Note real** — it's the smallest "mock → persisted" win: add a
  `notes` table (mirroring `profiles`) and a Server Action.
- **Replace the Nutrition + Activity mocks** with real data (e.g. derive the
  heatmap from `habit_completions` or `pomo_sessions` you already store).
- **Compute real streaks** from `habit_completions` instead of the counter.
- **Split `Dashboard.tsx`** into per-screen components + custom hooks
  (`usePomodoro`, `useCalendar`, `useTasks`). Good refactoring practice and makes
  everything after it easier.
- **Surface `data-accent` / `data-voice`** as Settings controls, since the CSS is
  already there.

When you write code, remember `AGENTS.md`'s warning: this Next.js version is
newer than most references, so check `node_modules/next/dist/docs/` for the
current API rather than assuming older conventions.

---

## 17. Quick reference

**Run it locally:**
```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev                        # http://localhost:3000
```

**Scripts** (`package.json`): `dev` (Turbopack dev server), `build`, `start`,
`lint`.

**The three "where do I look?" questions:**
- *Where's the UI?* → `src/components/Dashboard.tsx` + `src/app/globals.css`.
- *Where's a data mutation?* → a `"use server"` file in `src/lib/` (or
  `app/auth/actions.ts` for auth).
- *Where's auth enforced?* → `src/proxy.ts` (redirects) and the database RLS
  policies (data access).

---

## 18. Glossary

- **App Router** — Next.js's routing system where folders under `app/` are
  routes and components default to running on the server.
- **Server Component** — a React component that runs only on the server, can be
  `async`, and ships no JS to the browser. The default in `app/`.
- **Client Component** — a component marked `"use client"` that runs in the
  browser with normal React state/effects/events.
- **Server Action** — a `"use server"` function callable from client code; Next
  turns the call into a secure server-side RPC. Used for mutations + forms.
- **Route Handler** — a `route.ts` file exporting `GET`/`POST` etc.; the App
  Router's API endpoint. Used here for OAuth callbacks.
- **Proxy / Middleware** — `src/proxy.ts`, code that runs before matching
  requests reach a page (here: session refresh + auth redirects). Next 16 calls
  this the "Proxy"; older versions called it middleware.
- **Hydration** — the browser attaching React to server-rendered HTML to make it
  interactive. A "hydration mismatch" is when the server and first client render
  disagree (e.g. due to `Date.now()`/`Math.random()`), which React warns about.
- **RLS (Row Level Security)** — Postgres feature where the database itself
  decides which rows a user may read/write based on a policy. The app's real
  security boundary.
- **Migration** — a versioned SQL script that evolves the database schema; run in
  order to build the DB.
- **OAuth 2.0 / refresh token / access token** — the protocol for letting the app
  act on a user's behalf in Google/Microsoft. The long-lived refresh token is
  stored; it's exchanged for short-lived access tokens to call APIs.
- **anon key** — Supabase's public client key; safe to expose because RLS, not
  the key, controls data access.
- **oklch** — a perceptually-uniform color space (`oklch(lightness chroma hue)`)
  used for all the CSS color tokens.
- **Optimistic UI** — updating the interface immediately on a user action, before
  the server confirms, for perceived speed.
- **Stale-while-revalidate** — show cached data instantly, then refresh it in the
  background (the calendar's strategy).
- **Turbopack** — Next.js's fast bundler, used for the dev server here.
