"""Ground truth for web/lib/sipwcs.test.ts and the real-file check in web/lib/fits.test.ts.

Run from the repo root:  .venv/bin/python web/lib/testdata/gen_sip_ref.py
Writes web/lib/testdata/sip_ref.json. Needs numpy, astropy, requests.

What it stores
  cases[]  For 3 real SPHEREx cutouts from data/motion_13.2004_14.38_2025-07-09/images/ (three
           different detectors) plus the header of one full-size 2040 x 2040 file read from the
           public S3 bucket (its first 49152 bytes only), the IMAGE header cards that the WCS needs
           and about 50 sky points across the image with astropy's answers:
             world_to_pixel  -> x, y   (0-based, astropy's APE-14 convention, SIP applied)
             pixel_to_world  -> ra, dec
           The cutouts are small (about 127 x 176 px), so the full-size header is what exercises the
           SIP polynomial over the whole detector.
  block    A 5 x 5 block of IMAGE (float32) and FLAGS (int32) values read by astropy from one real
           cutout, with the byte offsets astropy reports, so the TypeScript FITS reader can be fed
           the same bytes and must return identical numbers.

About "-SIP": IRSA's current files (l2b-v27) already say RA---TAN-SIP, but older SPHEREx headers
carried the SIP terms without that suffix. astropy applies SIP coefficients whenever they are
present (it only logs an INFO "Inconsistent SIP distortion information" message when the suffix is
missing), so the ground truth is the same either way. This script checks that: it strips the
suffix from a copy of every header and asserts astropy gives the same pixels.
"""
import io
import json
import os
import re
import warnings

import numpy as np
import requests
from astropy import log
from astropy.io import fits
from astropy.wcs import WCS

log.setLevel("WARNING")  # hides the INFO message about the missing -SIP suffix (expected, see above)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
IMAGES = os.path.join(ROOT, "data", "motion_13.2004_14.38_2025-07-09", "images")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sip_ref.json")
CUTOUTS = ["2025W28_1B_0502_1_D3.fits", "2025W28_1B_0502_1_D6.fits", "2025W28_1B_0525_2_D2.fits"]
# A full-size file that covers Eros's field (from the IRSA SIA search at 13.2004, 14.38).
FULL_KEY = "qr3/level2/2026W32_1A/l2b-v27-2026-223/2/level2_2026W32_1A_0829_1D2_spx_l2b-v27-2026-223.fits"
FULL_URL = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/" + FULL_KEY
TARGET = (13.2004, 14.38)

# Only the cards the celestial WCS needs (primary keys only; alternate WCS "A" and "W" are skipped).
WCS_KEY = re.compile(r"^(NAXIS[12]?|CTYPE[12]|CUNIT[12]|CRPIX[12]|CRVAL[12]|CDELT[12]|PC[12]_[12]|"
                     r"CD[12]_[12]|LONPOLE|LATPOLE|RADESYS|EQUINOX|(A|B|AP|BP)_(ORDER|\d+_\d+))$")


def cards(h):
    out = {}
    for k in h.keys():
        if WCS_KEY.match(k) and k not in out:
            v = h[k]
            out[k] = v if isinstance(v, (bool, int, float, str)) else str(v)
    return out


def strip_sip(h):
    h2 = h.copy()
    for k in ("CTYPE1", "CTYPE2"):
        h2[k] = str(h2[k]).replace("-SIP", "")
    return h2


def make_case(name, source, h):
    w = WCS(h)
    assert w.sip is not None, f"{name}: astropy did not pick up the SIP terms"
    nx, ny = int(h["NAXIS1"]), int(h["NAXIS2"])
    # 7 x 7 pixel grid over the whole image (edges included) -> sky, plus the target position.
    gx, gy = np.meshgrid(np.linspace(0, nx - 1, 7), np.linspace(0, ny - 1, 7))
    px, py = gx.ravel(), gy.ravel()
    ra, dec = w.all_pix2world(px, py, 0)
    ra = np.append(ra, TARGET[0])
    dec = np.append(dec, TARGET[1])
    px = np.append(px, np.nan)  # the target has no grid pixel of its own
    py = np.append(py, np.nan)
    # world_to_pixel is the APE-14 call; for a celestial WCS it runs all_world2pix(origin=0).
    from astropy.coordinates import SkyCoord
    sky = SkyCoord(ra, dec, unit="deg")
    x, y = w.world_to_pixel(sky)
    # The missing-suffix header must give the same answer (astropy applies SIP anyway).
    x2, y2 = WCS(strip_sip(h)).world_to_pixel(sky)
    assert np.allclose(x, x2, atol=1e-9) and np.allclose(y, y2, atol=1e-9), name
    nosip = WCS(h)
    nosip.sip = None
    xn, yn = nosip.world_to_pixel(sky)
    points = []
    for i in range(len(ra)):
        points.append({
            "ra": float(ra[i]), "dec": float(dec[i]),
            "x": float(x[i]), "y": float(y[i]),
            "grid_x": None if np.isnan(px[i]) else float(px[i]),
            "grid_y": None if np.isnan(py[i]) else float(py[i]),
        })
    sip_effect = float(np.max(np.hypot(x - xn, y - yn)))
    return {"name": name, "source": source, "naxis": [nx, ny], "cards": cards(h),
            "max_sip_effect_px": round(sip_effect, 4), "points": points}


def fetch_full_header():
    r = requests.get(FULL_URL, headers={"Range": "bytes=0-49151"}, timeout=120)
    r.raise_for_status()
    assert r.status_code == 206, r.status_code
    bio = io.BytesIO(r.content)
    fits.Header.fromfile(bio)  # PRIMARY
    return fits.Header.fromfile(bio)  # IMAGE


def make_block(fname, x0=60, y0=100, n=5):
    path = os.path.join(IMAGES, fname)
    with fits.open(path) as hdul:
        out = {"file": os.path.relpath(path, ROOT), "x0": x0, "y0": y0, "n": n, "hdus": []}
        for name in ("IMAGE", "FLAGS"):
            hdu = hdul[name]
            info = hdu.fileinfo()
            data = hdu.data
            blk = data[y0:y0 + n, x0:x0 + n]  # numpy [row, col] = FITS row order (row 0 = FITS y=1)
            out["hdus"].append({
                "name": name, "bitpix": int(hdu.header["BITPIX"]),
                "naxis1": int(hdu.header["NAXIS1"]), "naxis2": int(hdu.header["NAXIS2"]),
                "header_start": int(info["hdrLoc"]), "data_start": int(info["datLoc"]),
                "data_span": int(info["datSpan"]),
                "values": [[None if not np.isfinite(v) else float(v) for v in row] for row in blk],
            })
        out["hdu_names"] = [h.name for h in hdul]
        out["file_size"] = os.path.getsize(path)
    return out


def main():
    cases = []
    for f in CUTOUTS:
        h = fits.getheader(os.path.join(IMAGES, f), "IMAGE")
        cases.append(make_case(f, "data/motion_13.2004_14.38_2025-07-09/images/" + f, h))
    cases.append(make_case("full-size " + os.path.basename(FULL_KEY), FULL_URL + " (bytes 0-49151)",
                           fetch_full_header()))
    for c in cases:
        print(f"{c['name']}: detector size {c['naxis']}, {len(c['points'])} points, "
              f"SIP moves pixels by up to {c['max_sip_effect_px']} px")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        block = make_block(CUTOUTS[0])
    ref = {"generator": "web/lib/testdata/gen_sip_ref.py", "astropy": __import__("astropy").__version__,
           "convention": "x, y are 0-based pixel coordinates (astropy origin=0); FITS 1-based = x + 1",
           "cases": cases, "block": block}
    with open(OUT, "w") as fh:
        json.dump(ref, fh, indent=1)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
