"use client";

// Inspect section C: the 102-band spectrum of a circle around the inspected pixel (aperture
// photometry with a background ring, lib/aperture.ts), the ice-free continuum as the model curve,
// and the ice dips (H2O 3.0, CO2 4.27, CO 4.67 um) as optical depth when they reach 3 sigma.

import { useEffect, useMemo, useState } from "react";
import { iceDips, loadApertureSpectrum, RADIUS_MAX, RADIUS_MIN, type ApertureSpectrum } from "@/lib/aperture";
import { FEATURES, FEATURE_MIN_SIGMA } from "@/lib/inspect";
import type { Field, Vision } from "@/lib/types";
import SpectrumChart, { type MoleculeFamily, type SpectrumPoint } from "./SpectrumChart";

const dimStyle = { color: "var(--text-dim)", fontSize: 13 } as const;

const ICE_LABEL: Record<string, string> = { H2O: "H₂O", CO2: "CO₂", CO: "CO" };

/** Shaded ice bands: the measurement bands of the dips in FEATURES, so shading and numbers agree. */
const ICE_FAMILY: MoleculeFamily[] = [
  {
    id: "ice",
    label: "Ice in cold clouds",
    bands: FEATURES.filter((f) => f.kind === "dip").map((f) => ({
      name: f.feature,
      label: ICE_LABEL[f.feature] ?? f.feature,
      center_um: (f.band[0] + f.band[1]) / 2,
      range_um: f.band,
    })),
  },
];

export interface CircleSpectrumProps {
  field: Field;
  x: number;
  y: number;
  radius: number;
  onRadius(r: number): void;
  vision?: Vision;
}

export default function CircleSpectrum({ field, x, y, radius, onRadius, vision }: CircleSpectrumProps) {
  const px = Math.round(x);
  const py = Math.round(y);
  // Tagged with its request key, so a slow answer for an old circle never shows for a new one.
  const reqKey = `${field.slug}|${px}|${py}|${radius}`;
  const [result, setResult] = useState<{ key: string; spec: ApertureSpectrum | null; failed: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    loadApertureSpectrum(field, px, py, radius)
      .then((spec) => {
        if (alive) setResult({ key: reqKey, spec, failed: false });
      })
      .catch(() => {
        if (alive) setResult({ key: reqKey, spec: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [field, px, py, radius, reqKey]);

  const current = result && result.key === reqKey ? result : null;
  const spec = current?.spec ?? null;
  const ice = useMemo(() => (spec ? iceDips(spec) : null), [spec]);
  const points: SpectrumPoint[] = useMemo(
    () => (spec ? spec.wl.map((wl, i) => ({ wl, value: spec.flux[i], err: spec.err[i], band: spec.band[i], det: spec.det[i], date: spec.dateObs[i] })) : []),
    [spec],
  );
  const set = (r: number) => onRadius(Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r)));
  const arcsec = (r: number) => (r * (field.pixel_arcsec || 6.15)).toFixed(1);

  const control = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
      <button type="button" aria-label="Smaller circle" onClick={() => set(radius - 1)} disabled={radius <= RADIUS_MIN}>
        −
      </button>
      <input
        type="range"
        min={RADIUS_MIN}
        max={RADIUS_MAX}
        step={1}
        value={radius}
        aria-label="Circle radius, pixels"
        onChange={(e) => set(Number(e.currentTarget.value))}
      />
      <button type="button" aria-label="Larger circle" onClick={() => set(radius + 1)} disabled={radius >= RADIUS_MAX}>
        +
      </button>
      <span style={dimStyle}>
        r = {radius} px ({arcsec(radius)}″)
      </span>
    </div>
  );

  if (!current) return <>{control}<p style={{ ...dimStyle, margin: 0 }}>Loading spectrum…</p></>;
  if (current.failed) return <>{control}<p style={{ margin: 0 }}>Could not load the spectrum.</p></>;
  if (!spec) return <>{control}<p style={{ margin: 0 }}>No spectrum here.</p></>;

  const found = ice?.dips.filter((d) => d.detected) ?? [];
  return (
    <>
      {control}
      <SpectrumChart
        points={points}
        units="mJy"
        vision={vision}
        families={ICE_FAMILY}
        models={ice?.continuum ? [{ label: "Continuum (fit outside the ice bands)", ...ice.continuum }] : []}
        csvName={`${field.slug}_x${px}_y${py}_r${radius}.csv`}
      />
      <p style={{ ...dimStyle, margin: "var(--space-2) 0 0" }}>
        Light inside the circle minus the sky, from the median of the ring {spec.rIn} to {spec.rOut} px out.
      </p>
      {!ice?.continuum ? (
        <p style={{ margin: "var(--space-1) 0 0" }}>Too faint to measure ice: no ice dip above {FEATURE_MIN_SIGMA} σ.</p>
      ) : found.length === 0 ? (
        <p style={{ margin: "var(--space-1) 0 0" }}>No ice dip above {FEATURE_MIN_SIGMA} σ.</p>
      ) : (
        <ul style={{ margin: "var(--space-1) 0 0", paddingLeft: "1.2em" }} aria-label="Ice dips">
          {found.map((d) => (
            <li key={d.feature}>
              {ICE_LABEL[d.feature]} ice: dip {d.sigma.toFixed(1)} σ
              {d.tau !== null && d.tauErr !== null ? `, optical depth τ = ${d.tau.toFixed(2)} ± ${d.tauErr.toFixed(2)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
