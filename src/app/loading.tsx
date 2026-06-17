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
        gap: "10px",
        background: "var(--paper)",
        color: "var(--ink-3)",
      }}
    >
      <style>{`@keyframes neeyazPulse{0%,100%{opacity:.45}50%{opacity:1}}`}</style>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: "26px",
          fontWeight: 600,
          color: "var(--ink)",
          letterSpacing: "-0.01em",
          animation: "neeyazPulse 1.4s ease-in-out infinite",
        }}
      >
        NeeyazOS
      </div>
      <div style={{ fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Loading…
      </div>
    </div>
  );
}
