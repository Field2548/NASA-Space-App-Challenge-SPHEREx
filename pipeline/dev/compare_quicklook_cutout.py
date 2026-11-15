"""BUILD_PROMPT 16: Range-read pixels (web/lib/fits.ts, from the public S3 bucket) must equal IRSA's
own cutout of the same file and area.

Input: the JSON written by `QL_LIVE=1 QL_DUMP=rows.json npx vitest run lib/quicklook.live.test.ts`
(41 x 41 patch of the IMAGE HDU, 0-based origin x0, y0). This script asks IRSA's cutout service for
the same file (access_url) around the same position, maps the cutout onto the full frame with the
CRPIX difference of the two IMAGE headers (must be an integer shift), and compares pixel by pixel.

    python pipeline/dev/compare_quicklook_cutout.py rows.json
"""

import json
import sys

import numpy as np
from astropy.io import fits

sys.path.insert(0, ".")
from download import cutout_url  # noqa: E402


def main(path):
    d = json.load(open(path))
    patch = np.array(d["patch"], dtype=float)
    url = cutout_url(d["access_url"], d["ra"], d["dec"], "0.12")  # degrees; > 41 px
    with fits.open(url, memmap=False) as hl:
        h = hl["IMAGE"].header
        cut = hl["IMAGE"].data.astype(float)
    # The cutout keeps the full frame's WCS with CRPIX shifted by the cut origin.
    sx = d["crpix"][0] - h["CRPIX1"]  # full-frame CRPIX, read by lib/fits.ts from the S3 header
    sy = d["crpix"][1] - h["CRPIX2"]
    assert abs(sx - round(sx)) < 1e-6 and abs(sy - round(sy)) < 1e-6, (sx, sy)
    sx, sy = int(round(sx)), int(round(sy))
    x0, y0 = d["x0"] - sx, d["y0"] - sy
    ny, nx = patch.shape
    assert 0 <= x0 and 0 <= y0 and y0 + ny <= cut.shape[0] and x0 + nx <= cut.shape[1], (x0, y0, cut.shape)
    ref = cut[y0 : y0 + ny, x0 : x0 + nx]
    both = np.isfinite(patch) & np.isfinite(ref)
    nan_mismatch = int((np.isfinite(patch) != np.isfinite(ref)).sum())
    assert both.sum() > 0 and np.nanstd(ref) > 0
    diff = np.abs(patch[both] - ref[both])
    print(json.dumps({
        "obs_id": d["obs_id"], "detector": d["detector"], "shift": [sx, sy],
        "pixels_compared": int(both.sum()), "nan_both": int((~np.isfinite(patch) & ~np.isfinite(ref)).sum()),
        "nan_mismatch": nan_mismatch, "max_abs_diff": float(diff.max()),
        "ref_std": float(np.nanstd(ref)),
    }))


if __name__ == "__main__":
    main(sys.argv[1])
