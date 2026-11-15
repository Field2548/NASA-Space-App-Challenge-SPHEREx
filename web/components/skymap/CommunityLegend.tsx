// Legend for the community patches layer: glow from few to many patches, yours, reported.

import { COLORS } from "./communityLayer";

export function CommunityLegend({ className }: { className?: string }) {
  return (
    <div className={className} role="group" aria-label="Community patches legend">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--text-dim)" }}>few</span>
        <span
          aria-hidden="true"
          style={{
            width: 72,
            height: 8,
            borderRadius: 4,
            background: "linear-gradient(90deg, rgba(182,255,59,0.15), rgba(182,255,59,0.6) 50%, #f4ffd0)",
          }}
        />
        <span style={{ color: "var(--text-dim)" }}>many patches</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 4 }}>
        <Swatch color={COLORS.mine} label="yours" />
        <Swatch color={COLORS.reported} label="reported" />
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  );
}
