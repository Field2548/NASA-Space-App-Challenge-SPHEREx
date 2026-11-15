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
    """MJD (UTC) -> '2025-07-09T18:04:04', truncated to the second, like frames.csv.
    MJD 0 is 1858-11-17T00:00."""
    t = datetime(1858, 11, 17, tzinfo=timezone.utc) + timedelta(days=float(mjd))
    return t.strftime("%Y-%m-%dT%H:%M:%S")


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
    return {"ctype": ["RA---TAN", "DEC--TAN"], "crval": [ra, dec], "crpix": [float(half + 1), float(half + 1)],
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


SPHEREX_OBSERVER = "500@-163182"   # JPL Horizons id of the SPHEREx spacecraft as the observer
MID_EXPOSURE_DAYS = 57.6 / 86400   # MJD-AVG minus DATE-OBS of a level 2 image (about half XPOSURE)


def horizons_positions(track, mjds, wcs):
    """Pixel position of a known object as SPHEREx sees it: Horizons with the spacecraft as
    observer, at mid-exposure (a frame's mjd is the mean DATE-OBS, the start of exposure)."""
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    from astroquery.jplhorizons import Horizons
    jd = [Time(m + MID_EXPOSURE_DAYS, format="mjd", scale="utc").jd for m in mjds]
    eph = Horizons(id=track, id_type="smallbody", location=SPHEREX_OBSERVER,
                   epochs=jd).ephemerides(quantities="1")
    x, y = wcs.world_to_pixel(SkyCoord(eph["RA"], eph["DEC"], unit="deg"))
    return np.asarray(x), np.asarray(y), str(eph["targetname"][0])


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
    one large always-black patch at the border becomes "no data" (_uncovered), and there are
    only about 250 levels:
    "preview quality". The picture is exact all the same: drawing these values with the
    returned white point gives back the preview's gray levels. Only the S/N numbers are
    approximate (see _solve_stretch)."""
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
    frames[:, _uncovered(levels)] = np.nan
    frames[levels == 255] = white
    mjds = [float(Time(m["utc"]).mjd) for m in meta]
    return frames, wcs, mjds, 1.6, white


def _uncovered(levels, min_fraction=0.05):
    """Which pixels of 8-bit previews are "no data" rather than just dark. motion_frames blanks
    the pixels not covered by every frame, and the previews draw them black in all frames.
    Dark sky is black in all frames too (below the -1 sigma black point), and in the crowded
    Cygnus field such real dark patches reach 260 pixels. Coverage gaps come from detector
    edges: one large patch at the border (2100 pixels on Eros). So only border patches larger
    than 5% of the picture count as no data. A smaller gap is missed and reads as -1 sigma;
    no valid pixel of the five ready spots is thrown away (checked against the FITS)."""
    from scipy import ndimage
    always_black = (levels == 0).all(axis=0)
    labels, count = ndimage.label(always_black)
    out = np.zeros_like(always_black)
    for i in range(1, count + 1):
        patch = labels == i
        on_border = patch[0].any() or patch[-1].any() or patch[:, 0].any() or patch[:, -1].any()
        if on_border and patch.sum() >= min_fraction * always_black.size:
            out |= patch
    return out


def _solve_stretch(levels):
    """asinh(a) of the stretch behind 8-bit preview levels, a = (white - black) / soft.
    The stretch maps S/N v to gray = asinh((v - black) / soft) / asinh(a). Sky pixels have
    noise sigma 1 by construction (frames are in noise units), so the 25th percentile of the
    sky sits 0.6745 below its median in S/N. Find the asinh(a) that makes it so. Only the lower
    half of the distribution is used because stars fill the upper half in crowded fields.
    Measured against FITS on the five ready spots, the recovered values are always a little low:
    the white point by 9 to 28 percent and source S/N by 6 to 19 percent, worst on Makemake.
    The sky is within 0.09 sigma."""
    sky = levels[:, ~_uncovered(levels)]
    lo, hi = ((np.percentile(sky, q) + 0.5) / 255 for q in (25, 50))

    def gap(asinh_a):          # quartile-to-median distance in S/N; grows with asinh_a
        return SOFT_SIGMA * (np.sinh(hi * asinh_a) - np.sinh(lo * asinh_a))
    a0, a1 = 0.5, 12.0
    for _ in range(60):
        mid = (a0 + a1) / 2
        a0, a1 = (mid, a1) if gap(mid) < 0.6745 else (a0, mid)
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


NEAR_OBJECT_PX = 3.0      # a candidate within this distance of the known object is "on" it


def candidate_status(cand, mjds, t_ref, objects):
    """Say what a bot candidate is, by comparing its straight path with the known object's
    positions frame by frame (frames where the object is outside the picture do not count):
      known        on the object in at least 3 frames (or in every frame, if fewer than 3 count)
      alias        on the object in some frame but not enough: a wrong track that borrows
                   the object's light in those frames
      unconfirmed  never on a known object. Not a claim that it is real.
    Returns the keys to add to the candidate."""
    for obj in objects:
        near = []
        usable = [p for p in obj["positions"] if p["in_grid"]]
        for p in usable:
            dt = mjds[p["frame"] - 1] - t_ref
            dx = cand["x"] + cand["vx_px_per_day"] * dt - p["x"]
            dy = cand["y"] + cand["vy_px_per_day"] * dt - p["y"]
            if (dx * dx + dy * dy) ** 0.5 <= NEAR_OBJECT_PX:
                near.append(p["frame"])
        if usable and len(near) >= min(3, len(usable)):
            return {"status": "known", "object_id": obj["id"], "near_object_frames": near}
        if near:
            return {"status": "alias", "object_id": obj["id"], "near_object_frames": near}
    return {"status": "unconfirmed"}


def answer_key(folder, wcs, mjds, track=None, star=None, frames=None, noise_bar=None,
               nothing_moves=False):
    """The server-only answer key (field-schema.md section 6).
    track: a JPL Horizons small-body id; its position in every frame comes from
    horizons_positions. frames (top-down) adds the measured S/N at each position
    (max of the 3x3 pixels, as the repo's --track check does). change_snr is the same 3x3
    maximum in the frame minus the median of the other frames (motion_frames.residuals): stars
    cancel, so it tells whether the object itself is seen there. star is reserved for the
    Tier 2 star targets and not used yet. Each bot candidate gets a status (known, alias or
    unconfirmed), see candidate_status."""
    if star is not None:
        raise NotImplementedError("star targets are not built yet")
    _repo_imports()
    height, width = wcs.array_shape if wcs.array_shape else frames.shape[1:]
    mjds = np.asarray(mjds, dtype=float)
    t_ref = float(mjds.mean())
    objects = []
    if track:
        fx, fy, name = horizons_positions(track, list(mjds), wcs)
        x, y = to_top_down(fx, fy, height)
        days = mjds - t_ref
        resid = None
        if frames is not None:
            from motion_frames import residuals
            resid = np.array(residuals(list(frames)))     # each frame minus the others' median
        positions = []
        for k in range(len(mjds)):
            inside = bool(-0.5 <= x[k] <= width - 0.5 and -0.5 <= y[k] <= height - 0.5)
            p = {"frame": k + 1, "x": round(float(x[k]), 2), "y": round(float(y[k]), 2),
                 "in_grid": inside}
            if frames is not None and inside:
                ix, iy = int(round(x[k])), int(round(y[k]))
                box = frames[k, max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2]
                p["snr"] = round(float(np.nanmax(box)), 1) if np.isfinite(box).any() else None
                rbox = resid[k, max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2]
                p["change_snr"] = round(float(np.nanmax(rbox)), 1) if np.isfinite(rbox).any() else None
            positions.append(p)
        objects.append({"id": str(track), "name": name, "kind": "asteroid", "source": "JPL Horizons",
                        "positions": positions,
                        "vx_px_per_day": round(float(np.polyfit(days, x, 1)[0]), 3),
                        "vy_px_per_day": round(float(np.polyfit(days, y, 1)[0]), 3)})
    cands = read_candidates(folder, height)
    if noise_bar is None:
        cands = []          # never report a bot candidate without its noise bar
    for c in cands:
        c.update(candidate_status(c, mjds, t_ref, objects))
    return {"slug": None, "nothing_moves": bool(nothing_moves), "noise_bar_sigma": noise_bar,
            "t_ref_mjd": round(t_ref, 6), "objects": objects,
            "bot": {"source": "shift_stack.py", "candidates": cands}}


def fits_sky_grid(wcs, shape):
    """Sky position of every pixel of the FITS-order (bottom-up) grid, as the repo scripts use."""
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    return wcs.pixel_to_world(xx, yy)


def wavelength_map(path, in_wcs, wcs, shape, cells=8):
    """Coarse wavelength map of one cutout on our grid: cells x cells values in microns, rows
    top-down, at the centres of equal cells (field-schema.md section 7). Uses the spectral WCS
    (key 'W'), exactly as download.wavelength_at does. None where the cutout has no pixel.
    Also returns the bandwidth at the centre of the spot."""
    from astropy.io import fits
    from astropy.wcs import WCS
    h, w = shape
    cx = (np.arange(cells) + 0.5) * w / cells - 0.5                 # top-down grid pixels
    cy = (np.arange(cells) + 0.5) * h / cells - 0.5
    gx, gy = np.meshgrid(np.append(cx, (w - 1) / 2), np.append(cy, (h - 1) / 2))
    sky = wcs.pixel_to_world(gx, h - 1 - gy)                        # back to FITS row order
    px, py = in_wcs.world_to_pixel(sky)
    with fits.open(path) as hdul:
        hdr = hdul["IMAGE"].header
        ny, nx = hdul["IMAGE"].data.shape
        spectral = WCS(header=hdr, fobj=hdul, key="W")
        spectral.sip = None           # SIP must be off for the spectral WCS (IRSA tutorial)
        wl, bw = spectral.pixel_to_world(px, py)
    wl, bw = wl.to_value("um"), bw.to_value("um")
    inside = (px >= -0.5) & (px <= nx - 0.5) & (py >= -0.5) & (py <= ny - 0.5) & np.isfinite(wl)
    grid = [[round(float(wl[j, i]), 4) if inside[j, i] else None for i in range(cells)]
            for j in range(cells)]
    centre_bw = round(float(bw[cells, cells]), 4) if inside[cells, cells] else None
    return grid, centre_bw


def quantize_plane(plane, noise):
    """One exposure plane -> (u16 array, scale, offset, clipped). Linear, as the contract says.
    The step never exceeds noise / 2 (so rounding adds under 2% to the noise); if the range is
    too wide for that, the brightest pixels are clipped to 65534 and 'clipped' is True."""
    lo, hi = float(np.nanmin(plane)), float(np.nanmax(plane))
    offset = float(np.floor(lo * 1e4) / 1e4)
    scale = max((hi - offset) / (NODATA - 1), 1e-9)
    clipped = scale > noise / 2
    if clipped:
        scale = noise / 2
    scale = float(f"{scale:.6g}") if clipped else float(np.ceil(scale * 1e7) / 1e7)
    q = np.clip(np.rint((plane - offset) / scale), 0, NODATA - 1)
    return np.where(np.isfinite(plane), q, NODATA).astype("<u2"), scale, offset, bool(clipped)


def grid_for_shape(ra, dec, shape):
    """The north-up grid (spectral_bands.grid_wcs) that has exactly this (height, width).
    grid_wcs takes a field of view and returns 2 * half + 1 pixels, so pass the field of view
    that makes half = (height - 1) / 2. Only odd, square grids exist in this project."""
    _repo_imports()
    from astropy.coordinates import SkyCoord
    from spectral_bands import grid_wcs
    h, w = shape
    wcs, got = grid_wcs(SkyCoord(ra, dec, unit="deg"), (h - 1) * PIXEL_ARCSEC / 3600)
    if tuple(got) != (h, w):
        raise ValueError(f"no centred grid of {w}x{h} pixels; pass wcs")
    return wcs


def export_exposures(folder, sky, out_dir, wcs=None):
    """Every single exposure behind the frames, on the frames' grid (field-schema.md section 7).
    folder: a motion_* folder with frames.csv and its downloaded cutouts in images/.
    sky: the FITS-order sky grid (fits_sky_grid). wcs: the frames' own WCS (pass it; it is
    rebuilt from the grid size when omitted). Writes out_dir/exposures.u16 and
    exposures.json; returns the JSON as a dict.
    Reuses clean_band (zodi and background removed, MJy/sr) and resample unchanged, and keeps
    the same planes build_frame keeps (more than 20% of the spot covered)."""
    _repo_imports()
    from astropy.io import fits
    from astropy.table import Table
    from astropy.time import Time
    from motion_frames import noise_of
    from spectral_bands import clean_band, resample, unique_images
    h, w = sky.shape
    ra, dec = folder_center(folder)
    if wcs is None:
        wcs = grid_for_shape(ra, dec, (h, w))
    urls = {}
    cache = os.path.join(folder, "sia_results.ecsv")
    if os.path.exists(cache):
        urls = {(i["obs_id"], i["detector"]): i["url"] for i in unique_images(Table.read(cache))}
    planes, items = [], []
    for m in read_frames_csv(folder):
        for name in m["files"]:
            path = os.path.join(folder, "images", name)
            img, in_wcs, _ = clean_band(path)
            plane = resample(img, in_wcs, sky)
            if not np.isfinite(plane).mean() > 0.2:
                continue                                  # build_frame skips these too
            noise = float(noise_of(plane))
            obs_id, det = name[:-5].rsplit("_D", 1)
            date_obs = str(fits.getheader(path, "IMAGE")["DATE-OBS"])
            q, scale, offset, clipped = quantize_plane(plane[::-1], noise)   # rows top-down
            grid, bandwidth = wavelength_map(path, in_wcs, wcs, (h, w))
            mjd = float(Time(date_obs).mjd)
            items.append({"k": len(items), "frame": m["i"], "mjd": round(mjd, 6),
                          "utc": date_obs[:19], "detector": int(det), "obs_id": obs_id,
                          "file": name, "source": urls.get((obs_id, int(det))),
                          "scale": scale, "offset": offset, "noise": float(f"{noise:.5g}"),
                          "clipped": clipped, "bandwidth_um": bandwidth, "wavelength_um": grid})
            planes.append(q)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "exposures.u16"), "wb") as f:
        f.write(np.array(planes, dtype="<u2").tobytes())
    info = {"file": "exposures.u16", "size": [w, h], "count": len(items), "units": "MJy/sr",
            "nodata": NODATA, "wavelength_grid": 8, "exposures": items}
    with open(os.path.join(out_dir, "exposures.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(info, f, separators=(",", ":"))
        f.write("\n")
    return info


def read_exposures(spot_dir):
    """Inverse of export_exposures: (planes K x H x W in MJy/sr with NaN, the JSON dict)."""
    with open(os.path.join(spot_dir, "exposures.json"), encoding="utf-8") as f:
        info = json.load(f)
    w, h = info["size"]
    q = np.fromfile(os.path.join(spot_dir, info["file"]), dtype="<u2").reshape(info["count"], h, w)
    planes = np.array([np.where(q[e["k"]] == NODATA, np.nan, q[e["k"]] * e["scale"] + e["offset"])
                       for e in info["exposures"]])
    return planes, info


def rebuild_frame(planes, noises):
    """Reference for the browser's wavelength switch: merge exposure planes into one frame the
    way motion_frames.build_frame does (each plane in noise units, 3-sigma-clipped mean of 3 or
    more, plain mean of fewer, then divided by the frame's own noise). Rows stay as given."""
    _repo_imports()
    from astropy.stats import sigma_clip
    from motion_frames import noise_of
    sn = [p / n for p, n in zip(planes, noises)]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        if len(sn) >= 3:
            frame = sigma_clip(np.array(sn), sigma=3, axis=0, cenfunc="median",
                               stdfunc="mad_std", masked=True).mean(axis=0).filled(np.nan)
        else:
            frame = np.nanmean(sn, axis=0)
    return frame / noise_of(frame)


def public_title(ra, dec):
    """A title that does not give the answer away: the constellation of the spot centre."""
    from astropy.coordinates import SkyCoord, get_constellation
    return f"Field in {get_constellation(SkyCoord(ra, dec, unit='deg'))}"


def public_difficulty(difficulty):
    """The control spot must not be recognisable: it is listed (and scored) as medium."""
    return "medium" if difficulty == "control" else difficulty


def export_field(folder, slug, title, difficulty, out_dir, track=None, star=None, kind="asteroid",
                 fov=0.2, noise_bar=None, nothing_moves=False, answers_dir=None, bands=None):
    """Export one spot. out_dir is web/public/fields; the answer key goes to answers_dir
    (default web/data/answers next to it, never under public/). bands: a data/bands_<slug>
    folder; when it holds cube.fits the spectrum tiles are written (section 8).
    The public files get a neutral title, kind 'spot' and a non-revealing difficulty; the real
    ones go into the answer key's 'reveal' block (issue #10).
    Returns field.json as a dict."""
    if star is not None:
        raise NotImplementedError("star targets are not built yet")
    out_dir = os.path.abspath(out_dir)
    answers_dir = answers_dir or os.path.join(os.path.dirname(os.path.dirname(out_dir)),
                                              "data", "answers")
    if "public" in os.path.abspath(answers_dir).split(os.sep):
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
        "slug": slug, "title": public_title(ra, dec), "kind": "spot",
        "difficulty": public_difficulty(difficulty),
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
    images = os.path.join(folder, "images")
    if precision == "float" and all(os.path.exists(os.path.join(images, name))
                                    for m in meta for name in m["files"]):
        export_exposures(folder, fits_sky_grid(wcs, (h, w)), spot, wcs=wcs)
        field["has"]["exposures"] = True
    else:                                    # no cutouts: drop stale files, hide the feature
        for name in ("exposures.u16", "exposures.json"):
            if os.path.exists(os.path.join(spot, name)):
                os.remove(os.path.join(spot, name))
    if bands and os.path.exists(os.path.join(bands, "cube.fits")):
        from spectrum_tiles import check_cube_grid, export_spectrum_tiles
        check_cube_grid(bands, [w, h], field["wcs"]["crval"], field["wcs"]["crpix"])
        export_spectrum_tiles(bands, spot)
        field["has"]["spectrum"] = True
    elif os.path.isdir(os.path.join(spot, "spectrum")):      # no cube: drop stale tiles
        import shutil
        shutil.rmtree(os.path.join(spot, "spectrum"))
    write_json(os.path.join(spot, "field.json"), field)
    update_index(out_dir, {"slug": slug, "title": field["title"], "ra": ra, "dec": dec, "fov_deg": fov,
                           "difficulty": field["difficulty"], "kind": field["kind"],
                           "thumbnail": f"{slug}/thumbs/1.webp"})
    key = answer_key(folder, wcs, mjds, track=track, star=star, frames=frames,
                     noise_bar=noise_bar, nothing_moves=nothing_moves)
    key["slug"] = slug
    key["reveal"] = {"title": title, "kind": kind, "difficulty": difficulty}
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
    p.add_argument("--bands", help="a data/bands_* folder (cube.fits) for the spectrum tiles; "
                                   "--all uses data/bands_<slug> when it exists")
    p.add_argument("--out", default=os.path.join(ROOT, "web", "public", "fields"))
    return p.parse_args()


def main():
    a = parse_args()
    if a.star:
        raise SystemExit("--star is reserved for star targets, which are not built yet")
    if a.all:
        jobs = [dict(s, folder=os.path.join(ROOT, s["folder"])) for s in SPOTS]
    elif a.folder and a.slug and a.title and a.difficulty:
        jobs = [{"slug": a.slug, "folder": a.folder, "title": a.title, "kind": a.kind,
                 "difficulty": a.difficulty, "fov": a.fov, "track": a.track,
                 "noise_bar": a.noise_bar, "nothing_moves": a.nothing_moves, "bands": a.bands}]
    else:
        raise SystemExit("give FOLDER --slug --title --difficulty, or --all")
    for j in jobs:
        bands = j.get("bands") or (os.path.join(ROOT, "data", "bands_" + j["slug"]) if a.all else None)
        f = export_field(j["folder"], j["slug"], j["title"], j["difficulty"], a.out, bands=bands,
                         track=j.get("track"), kind=j["kind"], fov=j["fov"],
                         noise_bar=j.get("noise_bar"), nothing_moves=j.get("nothing_moves", False))
        print(f"{j['slug']}: {len(f['frames'])} frames {f['size'][0]}x{f['size'][1]}, "
              f"{f['data']['precision']}, scale {f['data']['scale']}, white {f['stretch']['white']}"
              + (", spectrum" if f["has"]["spectrum"] else ""))
    if a.all:
        # real spots have landed: the index lists them in game order, without the fixture
        with open(os.path.join(a.out, "index.json"), encoding="utf-8") as f:
            by_slug = {e["slug"]: e for e in json.load(f)}
        write_json(os.path.join(a.out, "index.json"), [by_slug[s["slug"]] for s in SPOTS])


if __name__ == "__main__":
    main()
