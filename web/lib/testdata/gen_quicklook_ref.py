"""Expected burst grouping for web/lib/quicklook.test.ts, computed by the repo's own Python.

Run from the repo root:  .venv/bin/python web/lib/testdata/gen_quicklook_ref.py
Writes web/lib/testdata/quicklook_ref.json. No network: it reads the cached IRSA search of the Eros
field (data/motion_13.2004_14.38_2025-07-09/sia_results.ecsv), dedupes it with
spectral_bands.unique_images and groups it with motion_frames.group_bursts (15-minute gap), exactly
as motion_frames.main does before it picks a window.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, ROOT)
from astropy.table import Table  # noqa: E402

from motion_frames import group_bursts  # noqa: E402
from spectral_bands import unique_images  # noqa: E402

CACHE = os.path.join(ROOT, "data", "motion_13.2004_14.38_2025-07-09", "sia_results.ecsv")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quicklook_ref.json")
GAP_MIN = 15


def main():
    results = Table.read(CACHE)
    rows = [{"obs_id": str(r["obs_id"]), "detector": int(str(r["energy_bandpassname"])[-1]),
             "collection": str(r["obs_collection"]), "t_min": float(r["t_min"])} for r in results]
    meta = {str(r["access_url"]): float(r["t_min"]) for r in results}
    images = [dict(img, mjd=meta[img["url"]]) for img in unique_images(results)]
    bursts = group_bursts(images, GAP_MIN)
    ref = {
        "generator": "web/lib/testdata/gen_quicklook_ref.py",
        "source": os.path.relpath(CACHE, ROOT),
        "gap_min": GAP_MIN,
        "rows": rows,
        "unique_count": len(images),
        "bursts": [[f"{img['obs_id']}|{img['detector']}" for img in b] for b in bursts],
    }
    with open(OUT, "w") as fh:
        json.dump(ref, fh, separators=(",", ":"))
    print(f"{len(rows)} rows -> {len(images)} unique -> {len(bursts)} bursts; wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
