"use client";
// Colour-vision picker: a labelled select of the modes lib/palettes timeColors supports.
// Red-green uses "deutan" (timeColors gives protan and deutan the same Okabe-Ito set).
//
// Props: { value: Vision; onChange(v: Vision): void; id?: string }

import { useId } from "react";
import type { Vision } from "@/lib/types";

export const VISION_OPTIONS: { value: Vision; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "deutan", label: "Red-green (deutan/protan)" },
  { value: "tritan", label: "Blue-yellow (tritan)" },
  { value: "mono", label: "Mono" },
];

export interface VisionPickerProps {
  value: Vision;
  onChange(v: Vision): void;
  id?: string;
}

export default function VisionPicker({ value, onChange, id }: VisionPickerProps) {
  const autoId = useId();
  const selectId = id ?? `vision-${autoId}`;
  // protan shares the red-green option
  const shown = value === "protan" ? "deutan" : value;
  return (
    <div>
      <label htmlFor={selectId}>Colour vision</label>{" "}
      <select id={selectId} value={shown} onChange={(e) => onChange(e.target.value as Vision)}>
        {VISION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
