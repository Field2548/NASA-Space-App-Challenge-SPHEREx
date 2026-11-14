#!/usr/bin/env python3
"""Download a small sample of SPHEREx images from NASA/IPAC IRSA.

How it works
------------
1. Ask IRSA's Simple Image Access v2 (SIA) service which SPHEREx images
   cover a sky position:  https://irsa.ipac.caltech.edu/SIA
2. Save that list (the "metadata table") as CSV.
3. Pick a small subset (one exposure per visit, in the chosen detector bands)
   and download *cutouts* around the position instead of the full images.
   A full SPHEREx Level-2 image is ~65 MB; a 0.3 deg cutout is < 1 MB once the
   PSF table (EPSF extension, ~4 MB) is dropped.
4. Write a manifest.json and (optionally) PNG previews, all reprojected onto
   the same north-up grid so frames can be blinked / animated over time.

Examples
--------
    python scripts/download_sample.py                       # M101, defaults
    python scripts/download_sample.py --ra 83.82 --dec -5.39 --name orion
    python scripts/download_sample.py --bands D1 D2 D3 D4 D5 D6 --max-files 40
    python scripts/download_sample.py --collection spherex_qr3 --keep-psf
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"

# SPHEREx headers carry SIP distortion terms without a "-SIP" CTYPE suffix.
# astropy applies them anyway (which is correct) but logs a long notice for
# every image; silence it.
try:
    from astropy import log as _astropy_log
    _astropy_log.setLevel("WARNING")
except ImportError:
    pass


def http_get(url: str, retries: int = 4) -> bytes:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return r.read()
        except Exception as exc:  # network hiccups: back off and retry
            if attempt == retries - 1:
                raise
            wait = 2 ** (attempt + 1)
            print(f"  retry in {wait}s ({exc})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def sia_query(ra: float, dec: float, radius: float, collection: str) -> list[dict]:
    params = {
        "COLLECTION": collection,
        "POS": f"circle {ra} {dec} {radius}",
        "RESPONSEFORMAT": "VOTABLE",
    }
    url = SIA_URL + "?" + urllib.parse.urlencode(params)
    print(f"Querying SIA: {url}")
    from astropy.io.votable import parse_single_table

    table = parse_single_table(io.BytesIO(http_get(url))).to_table(use_names_over_ids=True)
    rows = []
    for rec in table:
        row = {}
        for col in table.colnames:
            v = rec[col]
            row[col] = v.decode() if isinstance(v, bytes) else (None if v is None else v.item() if hasattr(v, "item") else v)
        rows.append(row)
    return rows


def pick_sample(rows: list[dict], bands: list[str], max_files: int) -> list[dict]:
    """One exposure per (visit, band), spread evenly over time."""
    wanted = {f"SPHEREx-{b.upper()}" for b in bands}
    rows = [r for r in rows if r["energy_bandpassname"] in wanted and r["dataproduct_subtype"] == "science"]
    rows.sort(key=lambda r: r["t_min"])
    seen, per_visit = set(), []
    for r in rows:
        visit = r["obs_id"].rsplit("_", 1)[0]  # 2025W19_2B_0346_1 -> 2025W19_2B_0346
        key = (visit, r["energy_bandpassname"])
        if key not in seen:
            seen.add(key)
            per_visit.append(r)
    if len(per_visit) <= max_files:
        return per_visit
    step = len(per_visit) / max_files
    return [per_visit[int(i * step)] for i in range(max_files)]


def central_wavelength(hdul, ra: float, dec: float) -> float | None:
    """Wavelength (micron) seen at (ra, dec). SPHEREx uses a linear variable
    filter, so wavelength changes across the detector."""
    try:
        from astropy.wcs import WCS

        hdr = hdul["IMAGE"].header
        x, y = WCS(hdr).all_world2pix([[ra, dec]], 0)[0]
        wwcs = WCS(hdr, fobj=hdul, key="W")
        return float(wwcs.pixel_to_world_values(x, y)[0])
    except Exception:
        return None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ra", type=float, default=210.80225, help="RA in deg (default: M101)")
    p.add_argument("--dec", type=float, default=54.34894, help="Dec in deg (default: M101)")
    p.add_argument("--name", default="m101", help="name for the output folder")
    p.add_argument("--size", type=float, default=0.3, help="cutout size in deg")
    p.add_argument("--collection", default="spherex_dr1", help="spherex_dr1, spherex_qr3, ...")
    p.add_argument("--bands", nargs="+", default=["D2"], help="detectors D1..D6 (D1-3: 0.75-2.4um, D4-6: 2.4-5um)")
    p.add_argument("--max-files", type=int, default=20)
    p.add_argument("--keep-psf", action="store_true", help="keep the ~4 MB EPSF extension")
    p.add_argument("--no-previews", action="store_true")
    p.add_argument("--out", default="data/sample")
    a = p.parse_args()

    from astropy.io import fits

    out = Path(a.out) / a.name
    (out / "fits").mkdir(parents=True, exist_ok=True)

    rows = sia_query(a.ra, a.dec, 0.001, a.collection)
    print(f"{len(rows)} SPHEREx images cover this position in {a.collection}")
    if not rows:
        sys.exit("Nothing found - try another position or --collection")
    with open(out / "sia_results.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    sample = pick_sample(rows, a.bands, a.max_files)
    print(f"Downloading {len(sample)} cutouts ({a.size} deg) ...")
    manifest = []
    for i, r in enumerate(sample, 1):
        fname = Path(urllib.parse.urlparse(r["access_url"]).path).name
        dest = out / "fits" / fname
        if not dest.exists():
            url = f"{r['access_url']}?center={a.ra},{a.dec}&size={a.size}"
            hdul = fits.open(io.BytesIO(http_get(url)))
            if not a.keep_psf and "EPSF" in hdul:
                del hdul["EPSF"]
            hdul.writeto(dest, overwrite=True)
        with fits.open(dest) as hdul:
            wl = central_wavelength(hdul, a.ra, a.dec)
        from astropy.time import Time

        entry = {
            "file": f"fits/{fname}",
            "obs_id": r["obs_id"],
            "band": r["energy_bandpassname"],
            "mjd": r["t_min"],
            "date_utc": Time(r["t_min"], format="mjd").isot[:19],
            "exptime_s": r["t_exptime"],
            "wavelength_um": round(wl, 4) if wl else None,
            "band_range_um": [round(r["em_min"] * 1e6, 3), round(r["em_max"] * 1e6, 3)],
            "full_image_url": r["access_url"],
        }
        manifest.append(entry)
        print(f"  [{i}/{len(sample)}] {entry['date_utc']} {entry['band']} "
              f"{entry['wavelength_um']} um  {dest.stat().st_size // 1024} KB")

    if not a.no_previews:
        make_previews(out, manifest, a.ra, a.dec, a.size)

    meta = {"target": a.name, "ra": a.ra, "dec": a.dec, "cutout_size_deg": a.size,
            "collection": a.collection, "source": SIA_URL, "frames": manifest}
    (out / "manifest.json").write_text(json.dumps(meta, indent=2))
    print(f"Done -> {out}")


def make_previews(out: Path, manifest: list[dict], ra: float, dec: float, size: float) -> None:
    """Reproject every cutout onto one north-up grid and save PNGs."""
    try:
        import numpy as np
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from astropy.io import fits
        from astropy.wcs import WCS
        from scipy.ndimage import map_coordinates
    except ImportError as exc:
        print(f"Skipping previews ({exc}); pip install -r requirements.txt")
        return

    npix = 256
    target = WCS(naxis=2)
    target.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    target.wcs.crval = [ra, dec]
    target.wcs.crpix = [npix / 2 + 0.5, npix / 2 + 0.5]
    target.wcs.cdelt = [-size / npix, size / npix]

    (out / "png").mkdir(exist_ok=True)
    for e in manifest:
        with fits.open(out / e["file"]) as h:
            img = h["IMAGE"].data.astype(float)
            flags = h["FLAGS"].data
            # Mask bad pixels for display. Bit 21 (SOURCE) only marks pixels
            # that contain a detected source - keep those, they are the science.
            bad = (flags.astype(np.int64) & ~(1 << 21)) != 0
            img[bad] = np.nan
            hdr = h["IMAGE"].header
        # map every output pixel -> sky -> input pixel, then interpolate
        yy, xx = np.mgrid[0:npix, 0:npix]
        sky = target.all_pix2world(np.c_[xx.ravel(), yy.ravel()], 0)
        src = WCS(hdr).all_world2pix(sky, 0)
        arr = map_coordinates(img, [src[:, 1], src[:, 0]], order=1, cval=np.nan).reshape(npix, npix)
        finite = arr[np.isfinite(arr)]
        if finite.size == 0:
            continue
        lo, hi = np.percentile(finite, [1, 99.7])
        stretched = np.arcsinh((np.clip(arr, lo, hi) - lo) / ((hi - lo) / 10 or 1))
        png = Path(e["file"]).with_suffix(".png").name
        plt.imsave(out / "png" / png, np.nan_to_num(stretched), cmap="inferno", origin="lower")
        e["preview"] = f"png/{png}"
    print(f"Previews written to {out / 'png'} (north up, east left, {npix}x{npix} px)")


if __name__ == "__main__":
    main()
