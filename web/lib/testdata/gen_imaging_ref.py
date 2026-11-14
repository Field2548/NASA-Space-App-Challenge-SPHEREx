"""Reference outputs for web/lib/imaging.test.ts, computed by the repo's own Python functions.

Run from web/:  PYTHONPATH=.. python lib/testdata/gen_imaging_ref.py  (needs numpy, astropy, astroquery, scipy)
Writes web/lib/testdata/imaging_ref.json. Re-run only if motion_frames.py changes.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.getcwd())
import motion_frames as m  # noqa: E402

rng = np.random.default_rng(7)
W, H, N = 12, 10, 4
frames = []
for k in range(N):
    f = rng.normal(0, 1, (H, W))
    f[3:6, 4:7] += 60 * (1.0 + 0.03 * k)  # static 3x3 star, band-to-band brightness drift: runs the scale-match branch
    f[7, 9] += 25          # second static star, varies a little between bursts
    f[7, 9] *= 1.0 + 0.05 * k
    f[2, 1 + 2 * k] += 15  # mover, 2 px per frame
    frames.append(f)
frames[1][0, 0] = np.nan   # nodata pixel

st = m.make_stretch(frames)
st_on = m.make_stretch(frames, lo_sigma=1.0)
grays = [st(f) for f in frames]
on = [st_on(f) for f in frames]
colors = m.time_colors(N)
res = m.residuals(frames)

med = np.nanmedian(np.stack(frames), axis=0)
white = max(float(np.nanpercentile(med, 99.8)), -1 + 10)
white_on = max(float(np.nanpercentile(med, 99.8)), 1 + 10)


def flat(a):
    return [None if not np.isfinite(v) else float(v) for v in np.asarray(a).ravel()]


out = {
    "w": W, "h": H,
    "frames": [flat(f) for f in frames],
    "white": white, "white_on": white_on,
    "grays": [flat(g) for g in grays],
    "on": [flat(g) for g in on],
    "colors": colors.tolist(),
    "onion_dark": flat(m.onion_dark(on, colors)),
    "onion_light": flat(m.onion_light(on, colors)),
    "residuals": [flat(r) for r in res],
    "changes": flat(m.changes(frames, colors)),
    "noise_of_frame0": float(m.noise_of(frames[0])),
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "imaging_ref.json")
with open(path, "w") as fh:
    json.dump(out, fh)
print("wrote", path, "white", white)
