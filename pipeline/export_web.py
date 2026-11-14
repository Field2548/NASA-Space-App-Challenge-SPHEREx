"""Export processed SPHEREx spots as files the web app can load.

File formats: docs/contracts/field-schema.md (the contract; keep both in step).

This module is imported by pipeline/make_fixture.py, so the helpers at the top need only
numpy and Pillow. Anything that needs astropy imports it inside the function.
"""
import json
import os
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

PIXEL_ARCSEC = 6.15          # same value as spectral_bands.PIXEL_SCALE
NODATA = 65535               # u16 value for "no data" (NaN)
BLACK_SIGMA, SOFT_SIGMA = -1.0, 2.0   # the shared stretch of motion_frames.make_stretch


def mjd_to_utc(mjd):
    """MJD (UTC) -> '2025-07-09T18:04:04'. MJD 0 is 1858-11-17T00:00."""
    t = datetime(1858, 11, 17, tzinfo=timezone.utc) + timedelta(days=float(mjd))
    return (t + timedelta(microseconds=500000)).strftime("%Y-%m-%dT%H:%M:%S")


def write_u16(frames, path):
    """Write planes (N, H, W), rows already top-down, as little-endian Uint16.
    value = round((x - offset) / scale); NaN -> 65535. One scale and offset for the whole file.
    Returns (scale, offset)."""
    a = np.asarray(frames, dtype=np.float64)
    lo, hi = float(np.nanmin(a)), float(np.nanmax(a))
    offset = float(np.floor(lo))
    scale = max(0.01, float(np.ceil((hi - offset) / (NODATA - 1) * 1e4) / 1e4))
    q = np.clip(np.rint((a - offset) / scale), 0, NODATA - 1)
    q = np.where(np.isfinite(a), q, NODATA).astype("<u2")
    with open(path, "wb") as f:
        f.write(q.tobytes())
    return scale, offset


def read_u16(path, shape, scale, offset):
    """Inverse of write_u16 (used by tests): float planes with NaN for no data."""
    q = np.fromfile(path, dtype="<u2").reshape(shape)
    return np.where(q == NODATA, np.nan, q * scale + offset)


def white_point(frames, black=BLACK_SIGMA):
    """White point of the shared stretch: 99.8th percentile of the median frame, at least
    black + 10 (same rule as motion_frames.make_stretch)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)      # pixels with no data in any frame
        med = np.nanmedian(np.asarray(frames, dtype=np.float64), axis=0)
    return max(float(np.nanpercentile(med, 99.8)), black + 10)


def stretch_gray(frame, white, black=BLACK_SIGMA, soft=SOFT_SIGMA):
    """S/N plane -> gray 0..1 with the shared asinh stretch (see field-schema.md section 2)."""
    a = (white - black) / soft
    x = np.clip((np.asarray(frame, dtype=np.float64) - black) / (white - black), 0, 1)
    return np.nan_to_num(np.arcsinh(a * x) / np.arcsinh(a))


def make_thumbs(frames, out_dir, size=48, white=None):
    """thumbs/<i>.webp (i from 1): gray previews with the shared stretch, rows top-down.
    Returns the paths relative to the spot folder."""
    from PIL import Image
    os.makedirs(os.path.join(out_dir, "thumbs"), exist_ok=True)
    white = white if white is not None else white_point(frames)
    names = []
    for i, frame in enumerate(frames, start=1):
        im = Image.fromarray((stretch_gray(frame, white) * 255).astype(np.uint8), mode="L")
        how = Image.NEAREST if size >= im.width else Image.BOX   # never smear when enlarging
        im.resize((size, size), how).save(os.path.join(out_dir, "thumbs", f"{i}.webp"),
                                          lossless=True)
        names.append(f"thumbs/{i}.webp")
    return names


def simple_wcs(ra, dec, half):
    """The field.json 'wcs' block for a centred grid of 2*half+1 pixels (grid_wcs layout)."""
    step = round(PIXEL_ARCSEC / 3600, 7)
    return {"ctype": ["RA---TAN", "DEC--TAN"], "crval": [ra, dec], "crpix": [half + 1, half + 1],
            "cdelt": [-step, step], "rows": "top-down"}


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")


def update_index(fields_dir, entry):
    """Add or replace one spot in web/public/fields/index.json (kept sorted as inserted)."""
    path = os.path.join(fields_dir, "index.json")
    items = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            items = json.load(f)
    items = [e for e in items if e["slug"] != entry["slug"]] + [entry]
    write_json(path, items)
    return items


# ------------------------------------------------------------------ real spots
# Everything below needs astropy and the repo's own scripts (imported lazily, so the
# fixture script and the helpers above run with numpy + Pillow alone).

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The five ready spots (BUILD_PROMPT 6.1). Noise bars are the README table values
# ("Shift-and-stack" section); Eros was never bot-searched, so it has none.
SPOTS = [
    {"slug": "eros", "folder": "data/motion_13.2004_14.38_2025-07-09", "title": "(433) Eros",
     "kind": "asteroid", "difficulty": "easy", "fov": 0.2, "track": "433", "noise_bar": None},
    {"slug": "hektor", "folder": "data/motion_184.3049_-6.3773_2025-12-24", "title": "(624) Hektor",
     "kind": "asteroid", "difficulty": "medium", "fov": 0.2, "track": "624", "noise_bar": 6.4},
    {"slug": "makemake", "folder": "data/motion_200.0075_21.523_2025-05-30",
     "title": "(136472) Makemake", "kind": "dwarf-planet", "difficulty": "hard", "fov": 0.1,
     "track": "136472", "noise_bar": 6.4},
    {"slug": "eris", "folder": "data/motion_26.3271_-0.4338_2026-01-06", "title": "(136199) Eris",
     "kind": "dwarf-planet", "difficulty": "boss", "fov": 0.1, "track": "136199", "noise_bar": 5.9},
    {"slug": "cygnus", "folder": "data/motion_304.6935_42.4437", "title": "Cygnus control field",
     "kind": "control", "difficulty": "control", "fov": 0.2, "track": None, "noise_bar": 8.4,
     "nothing_moves": True},
]


def _repo_imports():
    """The repo's scripts live at the top level; make them importable from pipeline/."""
    import sys
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)


def folder_center(folder):
    """(ra, dec) from a 'motion_<RA>_<DEC>[_<date>]' folder name."""
    parts = os.path.basename(os.path.normpath(folder)).split("_")
    return float(parts[1]), float(parts[2])


def read_frames_csv(folder):
    """frames.csv -> list of {i, utc, hours_since_prev, n_bands, detectors, files}."""
    import csv
    rows = []
    with open(os.path.join(folder, "frames.csv"), newline="") as f:
        for r in csv.DictReader(f):
            files = r["files"].split()
            dets = sorted({int(name.rsplit("_D", 1)[1].split(".")[0]) for name in files})
            rows.append({"i": int(r["frame"]), "utc": r["time_utc"],
                         "hours_since_prev": float(r["hours_since_previous"]),
                         "n_bands": int(r["n_bands"]), "detectors": dets, "files": files})
    return rows


def frames_from_fits(folder):
    """Best source: FOLDER/frames.fits (float S/N planes written by motion_frames.py).
    Returns (frames N x H x W with rows TOP-DOWN, astropy WCS of the FITS grid, mjds, fwhm_px).
    FITS row 0 is the bottom row; this is the one place where rows are flipped."""
    from astropy.io import fits
    from astropy.wcs import WCS
    with fits.open(os.path.join(folder, "frames.fits")) as hdul:
        hdr = hdul[0].header
        data = hdul[0].data.astype(np.float64)
    mjds = [float(hdr[f"MJD{k}"]) for k in range(1, data.shape[0] + 1)]
    return data[:, ::-1, :].copy(), WCS(hdr).celestial, mjds, float(hdr.get("PSFFWHM", 1.6))


def gray_levels(frames, white):
    """S/N planes -> the 8-bit gray levels motion_frames.to_png writes (floor of gray * 255)."""
    return np.array([(stretch_gray(f, white) * 255).astype(np.uint8) for f in frames])


def frames_from_png(folder, fov):
    """Fallback without FITS: rebuild approximate S/N planes from the committed frame_k.png
    previews. Returns the same tuple as frames_from_fits, plus the white point it derived.

    The previews are the frames after the shared asinh stretch (black at -1 sigma, softening
    2 sigma), upscaled by an integer factor with nearest neighbour. So: take every factor-th
    pixel to get the native grid back, then undo the stretch. The white point is not stored;
    _solve_stretch recovers it from the sky noise. Values are clipped to [-1 sigma, white],
    pixels black in every frame become "no data", and there are only about 250 levels:
    "preview quality"."""
    _repo_imports()
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    from PIL import Image
    from spectral_bands import grid_wcs
    ra, dec = folder_center(folder)
    wcs, (h, w) = grid_wcs(SkyCoord(ra, dec, unit="deg"), fov)
    meta = read_frames_csv(folder)
    levels = []
    for m in meta:
        im = np.asarray(Image.open(os.path.join(folder, f"frame_{m['i']}.png")).convert("L"))
        up = im.shape[0] // h
        if im.shape != (h * up, w * up):
            raise ValueError(f"{folder}/frame_{m['i']}.png is {im.shape}, not a multiple of {h}x{w}")
        levels.append(im[::up, ::up])
    levels = np.array(levels, dtype=np.float64)
    asinh_a = _solve_stretch(levels)
    white = float(SOFT_SIGMA * np.sinh(asinh_a) + BLACK_SIGMA)
    frames = BLACK_SIGMA + SOFT_SIGMA * np.sinh((levels + 0.5) / 255 * asinh_a)
    frames[levels == 0] = BLACK_SIGMA
    # motion_frames blanks the same uncovered pixels in every frame; a covered pixel is black
    # (below -1 sigma) in all frames only by rare chance (0.16^N), so "always black" = no data
    frames[:, (levels == 0).all(axis=0)] = np.nan
    frames[levels == 255] = white
    mjds = [float(Time(m["utc"]).mjd) for m in meta]
    return frames, wcs, mjds, 1.6, white


def _solve_stretch(levels):
    """asinh(a) of the stretch behind 8-bit preview levels, a = (white - black) / soft.
    The stretch maps S/N v to gray = asinh((v - black) / soft) / asinh(a). Sky pixels have
    noise sigma 1 by construction (frames are in noise units), so the gap between the 25th
    and 75th percentile of the sky is 1.349 in S/N. Find the asinh(a) that makes it so."""
    sky = levels[(levels > 0) & (levels < 255)]
    lo, hi = ((np.percentile(sky, q) + 0.5) / 255 for q in (25, 75))

    def gap(asinh_a):          # interquartile range in S/N for this guess; grows with asinh_a
        return SOFT_SIGMA * (np.sinh(hi * asinh_a) - np.sinh(lo * asinh_a))
    a0, a1 = 0.5, 12.0
    for _ in range(60):
        mid = (a0 + a1) / 2
        a0, a1 = (mid, a1) if gap(mid) < 1.349 else (a0, mid)
    return (a0 + a1) / 2


def to_top_down(x, y, height):
    """FITS 0-based pixel (x, y from the bottom) -> contract pixel (x, y from the top)."""
    return np.asarray(x, dtype=float), height - 1 - np.asarray(y, dtype=float)


def read_candidates(folder, height):
    """candidates.csv (shift_stack.py) -> contract form: y and vy flipped to top-down."""
    import csv
    path = os.path.join(folder, "candidates.csv")
    out = []
    if os.path.exists(path):
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                out.append({"rank": int(r["rank"]), "x": int(r["x"]), "y": height - 1 - int(r["y"]),
                            "vx_px_per_day": float(r["vx_px_per_day"]),
                            "vy_px_per_day": -float(r["vy_px_per_day"]),
                            "stacked_snr": float(r["stacked_snr"]),
                            "above_noise_bar": r["above_noise_bar"] == "True",
                            "snr_per_frame": [float(v) for v in r["snr_per_frame"].split()]})
    return out


def answer_key(folder, wcs, mjds, track=None, star=None, frames=None, noise_bar=None,
               nothing_moves=False):
    """The server-only answer key (field-schema.md section 6).
    track: a JPL Horizons small-body id; its position in every frame comes from
    motion_frames.track_positions. frames (top-down) adds the measured S/N at each position
    (max of the 3x3 pixels, as the repo's --track check does). star is reserved for the
    Tier 2 star targets and not used yet."""
    _repo_imports()
    height, width = wcs.array_shape if wcs.array_shape else frames.shape[1:]
    mjds = np.asarray(mjds, dtype=float)
    t_ref = float(mjds.mean())
    objects = []
    if track:
        from motion_frames import track_positions
        fx, fy, name = track_positions(track, list(mjds), wcs)
        x, y = to_top_down(fx, fy, height)
        days = mjds - t_ref
        positions = []
        for k in range(len(mjds)):
            inside = bool(-0.5 <= x[k] <= width - 0.5 and -0.5 <= y[k] <= height - 0.5)
            p = {"frame": k + 1, "x": round(float(x[k]), 2), "y": round(float(y[k]), 2),
                 "in_grid": inside}
            if frames is not None and inside:
                ix, iy = int(round(x[k])), int(round(y[k]))
                box = frames[k, max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2]
                p["snr"] = round(float(np.nanmax(box)), 1) if np.isfinite(box).any() else None
            positions.append(p)
        objects.append({"id": str(track), "name": name, "kind": "asteroid", "source": "JPL Horizons",
                        "positions": positions,
                        "vx_px_per_day": round(float(np.polyfit(days, x, 1)[0]), 3),
                        "vy_px_per_day": round(float(np.polyfit(days, y, 1)[0]), 3)})
    cands = read_candidates(folder, height)
    if noise_bar is None:
        cands = []          # never report a bot candidate without its noise bar
    return {"slug": None, "nothing_moves": bool(nothing_moves), "noise_bar_sigma": noise_bar,
            "t_ref_mjd": round(t_ref, 6), "objects": objects,
            "bot": {"source": "shift_stack.py", "candidates": cands}}


def export_field(folder, slug, title, difficulty, out_dir, track=None, star=None, kind="asteroid",
                 fov=0.2, noise_bar=None, nothing_moves=False, answers_dir=None):
    """Export one spot. out_dir is web/public/fields; the answer key goes to answers_dir
    (default web/data/answers next to it, never under public/). Returns field.json as a dict."""
    out_dir = os.path.abspath(out_dir)
    answers_dir = answers_dir or os.path.join(os.path.dirname(os.path.dirname(out_dir)),
                                              "data", "answers")
    if os.sep + "public" in os.path.abspath(answers_dir):
        raise ValueError("answer keys must not be written under public/")
    spot = os.path.join(out_dir, slug)
    os.makedirs(spot, exist_ok=True)
    if os.path.exists(os.path.join(folder, "frames.fits")):
        frames, wcs, mjds, fwhm = frames_from_fits(folder)
        precision, white = "float", white_point(frames)
    else:
        frames, wcs, mjds, fwhm, white = frames_from_png(folder, fov)
        precision = "png8"
    n, h, w = frames.shape
    wcs.array_shape = (h, w)
    ra, dec = (float(v) for v in wcs.wcs.crval)
    scale, offset = write_u16(frames, os.path.join(spot, "frames.u16"))
    thumbs = make_thumbs(frames, spot, white=white)
    meta = read_frames_csv(folder)
    if len(meta) != n:
        raise ValueError(f"{folder}: frames.csv has {len(meta)} rows but there are {n} frames")
    field = {
        "slug": slug, "title": title, "kind": kind, "difficulty": difficulty,
        "ra": ra, "dec": dec, "fov_deg": fov, "pixel_arcsec": PIXEL_ARCSEC, "size": [w, h],
        "wcs": {"ctype": ["RA---TAN", "DEC--TAN"], "crval": [ra, dec],
                "crpix": [float(v) for v in wcs.wcs.crpix],
                "cdelt": [round(float(v), 7) for v in wcs.wcs.cdelt], "rows": "top-down"},
        "frames": [{"i": m["i"], "mjd": round(mjds[k], 6), "utc": mjd_to_utc(mjds[k]),
                    "hours_since_prev": 0 if k == 0 else round((mjds[k] - mjds[k - 1]) * 24, 2),
                    "n_bands": m["n_bands"], "detectors": m["detectors"]}
                   for k, m in enumerate(meta)],
        "data": {"format": "u16", "file": "frames.u16", "scale": scale, "offset": offset,
                 "units": "S/N", "precision": precision, "nodata": NODATA},
        "thumbs": thumbs,
        "stretch": {"black_sigma": BLACK_SIGMA, "soft_sigma": SOFT_SIGMA, "white": round(white, 3)},
        "psf_fwhm_px": round(fwhm, 3),
        "has": {"exposures": False, "spectrum": False},
    }
    write_json(os.path.join(spot, "field.json"), field)
    update_index(out_dir, {"slug": slug, "title": title, "ra": ra, "dec": dec, "fov_deg": fov,
                           "difficulty": difficulty, "kind": kind,
                           "thumbnail": f"{slug}/thumbs/1.webp"})
    key = answer_key(folder, wcs, mjds, track=track, star=star, frames=frames,
                     noise_bar=noise_bar, nothing_moves=nothing_moves)
    key["slug"] = slug
    for obj in key["objects"]:
        obj["kind"] = kind if kind in ("asteroid", "dwarf-planet") else obj["kind"]
    write_json(os.path.join(answers_dir, f"{slug}.json"), key)
    return field


def parse_args():
    import argparse
    p = argparse.ArgumentParser(description="Export a processed motion_* folder for the web app.")
    p.add_argument("folder", nargs="?", help="a data/motion_* folder (frames.fits if present, "
                                             "else the committed frame_k.png previews)")
    p.add_argument("--all", action="store_true", help="export the five ready spots (SPOTS table)")
    p.add_argument("--slug")
    p.add_argument("--title")
    p.add_argument("--difficulty", choices=["easy", "medium", "hard", "boss", "control"])
    p.add_argument("--kind", default="asteroid",
                   choices=["asteroid", "dwarf-planet", "control", "star"])
    p.add_argument("--fov", type=float, default=0.2, help="field of view in degrees (default 0.2)")
    p.add_argument("--track", help="JPL Horizons small-body id of the known object")
    p.add_argument("--star", help="reserved for star targets")
    p.add_argument("--noise-bar", type=float, help="the bot search's noise bar (sigma)")
    p.add_argument("--nothing-moves", action="store_true", help="control spot")
    p.add_argument("--out", default=os.path.join(ROOT, "web", "public", "fields"))
    return p.parse_args()


def main():
    a = parse_args()
    if a.all:
        jobs = [dict(s, folder=os.path.join(ROOT, s["folder"])) for s in SPOTS]
    elif a.folder and a.slug and a.title and a.difficulty:
        jobs = [{"slug": a.slug, "folder": a.folder, "title": a.title, "kind": a.kind,
                 "difficulty": a.difficulty, "fov": a.fov, "track": a.track,
                 "noise_bar": a.noise_bar, "nothing_moves": a.nothing_moves}]
    else:
        raise SystemExit("give FOLDER --slug --title --difficulty, or --all")
    for j in jobs:
        f = export_field(j["folder"], j["slug"], j["title"], j["difficulty"], a.out,
                         track=j.get("track"), kind=j["kind"], fov=j["fov"],
                         noise_bar=j.get("noise_bar"), nothing_moves=j.get("nothing_moves", False))
        print(f"{j['slug']}: {len(f['frames'])} frames {f['size'][0]}x{f['size'][1]}, "
              f"{f['data']['precision']}, scale {f['data']['scale']}, white {f['stretch']['white']}")
    if a.all:
        # real spots have landed: the index lists them in game order, without the fixture
        with open(os.path.join(a.out, "index.json"), encoding="utf-8") as f:
            by_slug = {e["slug"]: e for e in json.load(f)}
        write_json(os.path.join(a.out, "index.json"), [by_slug[s["slug"]] for s in SPOTS])


if __name__ == "__main__":
    main()
