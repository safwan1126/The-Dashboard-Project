// Streamed instantly while the dashboard's server data loads. Because this
// flushes the root layout's <head> (and its no-flash theme script) right away,
// the saved theme is applied before paint — no blank wait, no light→dark flash.
export default function Loading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s-2)",
        background: "var(--paper)",
        color: "var(--ink-3)",
      }}
    >
      <style>{`@keyframes lifePulse{0%,100%{opacity:.45}50%{opacity:1}}@media (prefers-reduced-motion: reduce){.life-pulse{animation:none!important}}`}</style>
      <div
        className="life-pulse"
        style={{
          fontFamily: "var(--serif)",
          fontSize: "var(--t-xl)",
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.01em",
          animation: "lifePulse 1.4s ease-in-out infinite",
        }}
      >
        LifeOS
      </div>
      <div style={{ fontSize: "var(--t-xs)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Loading…
      </div>
    </div>
  );
}
