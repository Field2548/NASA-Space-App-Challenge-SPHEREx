// Shared types. Contract: docs/contracts/types.md (owner GAME; change via a `contract` issue).
// Pixel x, y: native grid, rows top-down, origin at the top-left pixel centre.

export type RGB = [number, number, number]; // 0..255

export type Vision = "normal" | "protan" | "deutan" | "tritan" | "mono";

export type Difficulty = "easy" | "medium" | "hard" | "boss" | "expert" | "control"; // "control": legacy, public files no longer use it (issue #10)

// field.json kinds are DATA's (field-schema.md section 2); "quicklook" is browser-only.
export type FieldKind = "asteroid" | "dwarf-planet" | "control" | "star" | "fixture" | "quicklook" | "spot";

/** One burst (about 4 exposures, about 8 bands). */
export interface FrameMeta {
  i: number;
  mjd: number;
  utc: string;
  hours_since_prev: number;
  n_bands: number;
  detectors: number[];
}

/**
 * Gnomonic TAN, north up, east left. crpix is 1-based and bottom-up, exactly as in FITS;
 * the reference pixel on the 0-based top-down grid is (crpix[0] - 1, H - crpix[1]).
 */
export interface FieldWcs {
  ctype: [string, string];
  crval: [number, number];
  crpix: [number, number];
  cdelt: [number, number]; // deg per pixel
  rows: "top-down";
}

/** Encoding of frames.u16: S/N = value * scale + offset; value === nodata decodes to NaN. */
export interface FieldData {
  format: "u16";
  file: string;
  scale: number;
  offset: number;
  units: "S/N";
  precision: "float" | "png8";
  nodata: number; // always 65535
}

/** Which optional files exist for a spot; a missing key means false. */
export interface FieldHas {
  exposures?: boolean;
  spectrum?: boolean;
}

export interface FieldStretch {
  black_sigma: number;
  soft_sigma: number;
  white: number;
}

/** field.json (BP 6.2). */
export interface Field {
  slug: string;
  title: string;
  kind: FieldKind;
  difficulty: Difficulty;
  ra: number;
  dec: number;
  fov_deg: number;
  pixel_arcsec: number;
  size: [number, number]; // [width, height]
  wcs: FieldWcs;
  frames: FrameMeta[];
  data: FieldData;
  thumbs: string[];
  stretch: FieldStretch;
  psf_fwhm_px: number;
  has?: FieldHas;
}

/** One row of fields/index.json. */
export interface FieldSummary {
  slug: string;
  title: string;
  ra: number;
  dec: number;
  fov_deg: number;
  difficulty: Difficulty;
  kind: FieldKind;
  thumbnail: string;
}

/** One player click on a frame. */
export interface Mark {
  frame: number; // FrameMeta.i
  x: number;
  y: number;
  tDays: number; // days since the first frame
}

/** Straight-line motion fitted to marks: position at t = t0Days + dt is (x0 + vx*dt, y0 + vy*dt). */
export interface Track {
  x0: number;
  y0: number;
  t0Days: number;
  vx: number; // px per day
  vy: number;
  rms: number; // px
  marks: Mark[];
}

/** Body of POST /api/check (api.md section 3): raw marks, the server fits the track. */
export type CheckRequest =
  | { spot: string; answer: "track"; marks: { frame: number; x: number; y: number }[] }
  | { spot: string; answer: "nothing" };

/** Response of POST /api/check (api.md section 3). */
export interface CheckResponse {
  verdict: Verdict;
  first_finder: boolean;
  already_found: boolean;
  persisted: boolean;
  /** True after a correct verdict (known, bot_match, nothing_correct) or when the spot was already open (practice); a wrong answer on a locked spot leaves it locked. */
  unlocked: boolean;
  /** The spot was already open for this player: judged, but 0 points. */
  practice?: boolean;
  reveal?: { frame: number; x: number; y: number };
  track?: { x0: number; y0: number; vx: number; vy: number; rms: number; rate_arcsec_per_hour: number };
  noise_bar_sigma: number | null;
  /** Real title, kind and difficulty of the spot; sent only when unlocked (issue #10). */
  spot_reveal?: { title: string; kind: FieldKind; difficulty: Difficulty };
}

export type VerdictKind =
  | "known"
  | "bot_match"
  | "candidate"
  | "static"
  | "nothing_correct"
  | "nothing_wrong";

export interface Verdict {
  kind: VerdictKind;
  object_name?: string;
  points: number;
  message: string;
}

export interface Spectrum {
  wl: number[]; // micron
  /** Path (aperture) spectra are in mJy; cube (per-pixel) spectra are in MJy/sr. */
  flux: number[];
  err: number[]; // same unit as flux
  det?: number[];
}

/** One SPHEREx exposure (exposures.json and the quick-look list). */
export interface ExposureMeta {
  obs_id: string;
  mjd: number;
  utc: string;
  detector: number;
  frame?: number;
  path: string; // IRSA or S3 file path, for provenance
  wl_um?: number;
}

export interface ApiError {
  error: {
    code: "bad_request" | "unauthorized" | "not_found" | "rate_limited" | "upstream_failed" | "db_unavailable" | "internal";
    message: string;
    details?: Record<string, unknown>;
  };
}
