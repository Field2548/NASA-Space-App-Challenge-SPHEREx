// URL view state shared by /play and /embed: ?frames=a-b (onion range, 0-based frame indexes),
// ?spacing=real|even and ?vision=normal|protan|deutan|tritan|mono. Defaults are left out of the URL.

import type { Vision } from "@/lib/types";

export interface ViewState {
  frames: [number, number] | null; // null: the default onion range
  realSpacing: boolean;
  vision: Vision;
}

const VISIONS: readonly Vision[] = ["normal", "protan", "deutan", "tritan", "mono"];

export type RawParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Read the view params; anything malformed falls back to the default. */
export function parseView(p: RawParams): ViewState {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(one(p.frames) ?? "");
  const vision = one(p.vision) as Vision | undefined;
  return {
    frames: m ? [Number(m[1]), Number(m[2])] : null,
    realSpacing: one(p.spacing) === "real",
    vision: vision && VISIONS.includes(vision) ? vision : "normal",
  };
}

/** Write the view into `params` (a copy of the current query): defaults delete their key. */
export function applyView(params: URLSearchParams, v: ViewState): URLSearchParams {
  const out = new URLSearchParams(params);
  if (v.frames) out.set("frames", `${Math.min(...v.frames)}-${Math.max(...v.frames)}`);
  else out.delete("frames");
  if (v.realSpacing) out.set("spacing", "real");
  else out.delete("spacing");
  if (v.vision !== "normal") out.set("vision", v.vision);
  else out.delete("vision");
  return out;
}
