"""Write the synthetic 'fixture' spot: a tiny fake field for building and testing the web app
before (and without) real data. See docs/contracts/field-schema.md section 10.

    python pipeline/make_fixture.py            # writes web/public/fields/fixture/ and
                                               # web/data/answers/fixture.json

32x32 px, 4 frames 3 h apart, noise sigma 1, three still stars and one dot that moves 2 px
per frame. Deterministic (seed 42): running it again rewrites identical files.
This is NOT sky data and is never shown as a real spot.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_web import (BLACK_SIGMA, PIXEL_ARCSEC, SOFT_SIGMA, candidate_status, make_thumbs,  # noqa: E402
                        mjd_to_utc, simple_wcs, update_index, white_point, write_json, write_u16)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE, N_FRAMES, HALF = 32, 4, 16
MJD0, STEP_DAYS = 61000.0, 0.125                     # 3 hours between frames
FWHM_PX = 1.6
STARS = [(8, 8, 40.0), (24, 10, 25.0), (12, 25, 15.0)]   # x, y (top-down), peak S/N
MOVER = {"x0": 10, "y0": 16, "dx": 2, "dy": 0, "peak": 20.0}
NODATA_PIXEL = (31, 31)


def dot(x, y, peak):
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    s = FWHM_PX / 2.3548
    return peak * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * s * s))


def build():
    rng = np.random.default_rng(42)
    frames = []
    for k in range(N_FRAMES):
        f = rng.normal(0.0, 1.0, (SIZE, SIZE))
        for x, y, peak in STARS:
            f += dot(x, y, peak)
        f += dot(MOVER["x0"] + MOVER["dx"] * k, MOVER["y0"] + MOVER["dy"] * k, MOVER["peak"])
        f[NODATA_PIXEL[1], NODATA_PIXEL[0]] = np.nan
        frames.append(f)
    return np.array(frames)                           # rows are already top-down


def main():
    frames = build()
    spot = os.path.join(ROOT, "web", "public", "fields", "fixture")
    os.makedirs(spot, exist_ok=True)
    scale, offset = write_u16(frames, os.path.join(spot, "frames.u16"))
    thumbs = make_thumbs(frames, spot)
    mjds = [MJD0 + STEP_DAYS * k for k in range(N_FRAMES)]
    ra, dec = 150.0, 2.0
    field = {
        "slug": "fixture", "title": "Fixture (synthetic test spot)", "kind": "fixture",
        "difficulty": "easy", "ra": ra, "dec": dec,
        "fov_deg": round(SIZE * PIXEL_ARCSEC / 3600, 4), "pixel_arcsec": PIXEL_ARCSEC,
        "size": [SIZE, SIZE],
        # even-sized grid: reference pixel is (15, 16) top-down by the contract formula
        "wcs": simple_wcs(ra, dec, HALF - 1),
        "frames": [{"i": k + 1, "mjd": m, "utc": mjd_to_utc(m),
                    "hours_since_prev": 0 if k == 0 else STEP_DAYS * 24,
                    "n_bands": 8, "detectors": [3, 6]} for k, m in enumerate(mjds)],
        "data": {"format": "u16", "file": "frames.u16", "scale": scale, "offset": offset,
                 "units": "S/N", "precision": "float", "nodata": 65535},
        "thumbs": thumbs,
        "stretch": {"black_sigma": BLACK_SIGMA, "soft_sigma": SOFT_SIGMA,
                    "white": round(white_point(frames), 3)},
        "psf_fwhm_px": FWHM_PX,
        "has": {"exposures": False, "spectrum": False},
    }
    write_json(os.path.join(spot, "field.json"), field)
    # the fixture is listed in index.json only while no real spot has been exported
    index = os.path.join(os.path.dirname(spot), "index.json")
    real = False
    if os.path.exists(index):
        with open(index, encoding="utf-8") as f:
            real = any(e["slug"] != "fixture" for e in json.load(f))
    if not real:
        update_index(os.path.dirname(spot), {
            "slug": "fixture", "title": field["title"], "ra": ra, "dec": dec,
            "fov_deg": field["fov_deg"], "difficulty": "easy", "kind": "fixture",
            "thumbnail": "fixture/thumbs/1.webp"})

    t_ref = float(np.mean(mjds))
    vx, vy = MOVER["dx"] / STEP_DAYS, MOVER["dy"] / STEP_DAYS
    obj = {
        "id": "fixture-1", "name": "Fixture mover", "kind": "asteroid", "source": "synthetic",
        "positions": [{"frame": k + 1, "x": MOVER["x0"] + MOVER["dx"] * k,
                       "y": MOVER["y0"] + MOVER["dy"] * k, "in_grid": True}
                      for k in range(N_FRAMES)],
        "vx_px_per_day": vx, "vy_px_per_day": vy}
    candidate = {
        "rank": 1, "x": MOVER["x0"] + vx * (t_ref - MJD0), "y": MOVER["y0"] + vy * (t_ref - MJD0),
        "vx_px_per_day": vx, "vy_px_per_day": vy, "stacked_snr": 38.0,
        "above_noise_bar": True, "snr_per_frame": [19.0, 19.0, 19.0, 19.0]}
    candidate.update(candidate_status(candidate, np.asarray(mjds, dtype=float), t_ref, [obj]))
    answer = {
        "slug": "fixture", "nothing_moves": False, "noise_bar_sigma": 6.0, "t_ref_mjd": t_ref,
        "objects": [obj],
        "bot": {"source": "synthetic", "candidates": [candidate]},
    }
    write_json(os.path.join(ROOT, "web", "data", "answers", "fixture.json"), answer)
    print(f"fixture: {N_FRAMES} frames {SIZE}x{SIZE}, scale {scale}, offset {offset}, "
          f"white {field['stretch']['white']}")


if __name__ == "__main__":
    main()
