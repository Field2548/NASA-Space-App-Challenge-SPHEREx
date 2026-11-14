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


def make_thumbs(frames, out_dir, size=48):
    """thumbs/<i>.webp (i from 1): gray previews with the shared stretch, rows top-down.
    Returns the paths relative to the spot folder."""
    from PIL import Image
    os.makedirs(os.path.join(out_dir, "thumbs"), exist_ok=True)
    white = white_point(frames)
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
