"""Write pipeline/tests/ref/fits_sample.json: 400 random pixels of every frame of each ready spot,
read from frames.fits before it is exported.

It lets the round-trip test (test_export.py, "sample" tests) run on a checkout without the
gitignored frames.fits files. To regenerate it (needs the FITS files on disk):

    .venv/bin/python pipeline/tests/make_fits_sample.py
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
import export_web as ew  # noqa: E402

OUT = os.path.join(HERE, "ref", "fits_sample.json")


def sample(folder, count=400):
    frames = ew.frames_from_fits(folder)[0]
    n, h, w = frames.shape
    idx = np.sort(np.random.default_rng(12345).choice(frames.size, count, replace=False))
    vals = frames.reshape(-1)[idx]
    value = [None if np.isnan(v) else round(float(v), 6) for v in vals]
    return {"shape": [n, h, w], "index": [int(i) for i in idx], "value": value}


def main():
    obj = {}
    for spot in ew.SPOTS:
        folder = os.path.join(ROOT, spot["folder"])
        if not os.path.exists(os.path.join(folder, "frames.fits")):
            print(f"{spot['slug']}: no frames.fits, skipped")
            continue
        obj[spot["slug"]] = sample(folder)
        print(f"{spot['slug']}: {len(obj[spot['slug']]['index'])} samples")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
