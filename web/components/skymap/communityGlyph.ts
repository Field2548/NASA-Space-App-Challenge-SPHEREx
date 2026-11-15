// The glowing dots of the community density layer: a few pre-drawn sprites (colour x brightness),
// so drawing thousands of cells per frame is a drawImage each. Looks like night lights.

export type GlowKind = "community" | "reported" | "mine";

export const GLOW_LEVELS = 12;

const RGB: Record<GlowKind, [number, number, number]> = {
  community: [182, 255, 59], // #b6ff3b
  reported: [255, 176, 32],
  mine: [103, 232, 249],
};

/** Brightness step 0..levels-1 for a count against the busiest cell in view (log scale). */
export function glowLevel(count: number, max: number, levels: number = GLOW_LEVELS): number {
  if (!(count > 0) || !(max > 0)) return 0;
  const t = Math.log1p(Math.min(count, max)) / Math.log1p(max);
  return Math.max(0, Math.min(levels - 1, Math.round(t * (levels - 1))));
}

/** Sprite radius in CSS pixels and peak opacity for a brightness step. */
export function glowStyle(level: number, levels: number = GLOW_LEVELS): { radius: number; alpha: number } {
  const t = levels > 1 ? level / (levels - 1) : 1;
  return { radius: 4 + 10 * t, alpha: 0.35 + 0.65 * t };
}

const sprites = new Map<string, HTMLCanvasElement | null>();

/** The sprite for a kind and brightness step, or null where there is no canvas (tests). */
export function glowSprite(kind: GlowKind, level: number): HTMLCanvasElement | null {
  const key = `${kind}:${level}`;
  if (sprites.has(key)) return sprites.get(key) ?? null;
  let out: HTMLCanvasElement | null = null;
  try {
    const { radius, alpha } = glowStyle(level);
    const size = Math.ceil(radius * 2);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    if (g) {
      const [r, gr, b] = RGB[kind];
      const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
      grad.addColorStop(0, `rgba(255, 255, 235, ${alpha})`);
      grad.addColorStop(0.2, `rgba(${r}, ${gr}, ${b}, ${alpha})`);
      grad.addColorStop(0.55, `rgba(${r}, ${gr}, ${b}, ${alpha * 0.3})`);
      grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      out = c;
    }
  } catch {
    out = null;
  }
  sprites.set(key, out);
  return out;
}

/** What a density source carries. No names, no user info. */
export interface GlowData {
  kind: GlowKind;
  level: number;
}

/** Aladin custom shape: draws one cell's dot centred on the source. */
export function drawGlow(source: { x?: number; y?: number; data?: unknown }, ctx: CanvasRenderingContext2D): void {
  const d = source.data as GlowData | undefined;
  if (!d) return;
  const sprite = glowSprite(d.kind, d.level);
  if (sprite && source.x !== undefined && source.y !== undefined) ctx.drawImage(sprite, source.x - sprite.width / 2, source.y - sprite.height / 2);
}
