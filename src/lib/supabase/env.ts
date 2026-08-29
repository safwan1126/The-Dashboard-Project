// Next inlines `NEXT_PUBLIC_*` into the bundle at build time rather than
// reading it at runtime, so a build is permanently frozen to whatever the
// values were when `next build` ran (see
// node_modules/next/dist/docs/01-app/02-guides/environment-variables.md).
//
// That makes one mistake invisible: build with the CI placeholders from
// .github/workflows/ci.yml and the bundle points at https://placeholder.supabase.co
// forever. The host does not resolve, so every Supabase call dies inside undici
// and surfaces as a bare "fetch failed" — no mention of a URL, a build, or an
// env var. Editing .env.local afterwards changes nothing, which sends you
// hunting for a network or credentials problem that isn't there.
//
// Checking here turns that into an error that names its own fix.

const PLACEHOLDER = /placeholder/i;

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

function verify(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} was empty when this bundle was built. Next inlines NEXT_PUBLIC_* ` +
        `at build time, so adding it to .env.local now will not fix the running ` +
        `server — rebuild with it set.`
    );
  }

  if (PLACEHOLDER.test(value)) {
    throw new Error(
      `${name} was built in as "${value}" — the CI placeholder from ` +
        `.github/workflows/ci.yml, not a real Supabase project. Rebuild from a ` +
        `shell with no NEXT_PUBLIC_SUPABASE_* overrides so .env.local is used: ` +
        `npm run build`
    );
  }

  return value;
}

// Called when a client is created rather than at module load, so CI — which
// builds with the placeholders on purpose and never serves a request — stays
// green, while anything that actually talks to Supabase fails loudly.
export function supabaseEnv(): SupabaseEnv {
  return {
    // Both reads must stay written out in full. Next only inlines a literal
    // `process.env.NEXT_PUBLIC_FOO`; a dynamic lookup is left untouched and
    // would read as undefined in the browser.
    url: verify("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: verify(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
  };
}
