"""
Download SPHEREx cutouts of one sky spot over time, and prepare them for a game/app.

Based on IRSA's "Introduction to SPHEREx Spectral Images" tutorial:
https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/

What it does
    1. Finds every SPHEREx spectral image that covers your RA/Dec (SIA search).
    2. Downloads a small cutout of each one (with retries, like the tutorial).
    3. Reads the useful info from each cutout:
         - DATE-OBS, DETECTOR, OBSID, PSF_FWHM (IMAGE header)
         - the wavelength + bandwidth at your target (spectral WCS, key="W")
         - how many pixels are flagged bad (FLAGS extension)
    4. Optionally removes zodiacal light (ZODI extension) and saves PNGs.
    5. Writes index.csv so your app knows the time and wavelength of every frame.

Setup
    pip install numpy matplotlib astropy astroquery
    pip install firefly-client          # only if you use --firefly

Usage
    python download_spherex.py RA DEC [options]

Examples (RA/Dec in degrees)
    python download_spherex.py 304.6935 42.4437 --max 10
    python download_spherex.py 304.6935 42.4437 --max 10 --png --subtract-zodi
    python download_spherex.py 304.6935 42.4437 --max 5 --firefly

Output (in --out folder, default "data/")
    cutout_000_2025-04-29T00-24-27.fits    full cutout, all extensions kept
    cutout_000_2025-04-29T00-24-27.png     (with --png) image for your app
    cutout_000_2025-04-29T00-24-27_mask.png (with --png) white = bad pixel
    index.csv                              one row per frame, oldest first
"""
import argparse
import csv
import http.client
import os
import time
import urllib.error

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.utils.data import conf
from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa

# Reading SPHEREx files can take longer than astropy's default timeout (tutorial tip).
conf.remote_timeout = 120

# FLAGS bits we treat as "bad pixel" (names come from the FLAGS header MSKN* keywords).
# SOURCE (pixel on a known source) is NOT bad -- it's kept separate, because it is
# useful for telling stars apart from movers.
BAD_FLAG_NAMES = {
    "TRANSIENT", "OVERFLOW", "SUR_ERROR", "NONFUNC", "MISSING_DATA", "HOT", "COLD",
    "NONLINEAR", "PERSIST", "OUTLIER", "CROSSTALK", "GHOST", "GHOST_FPA",
    "GHOST_EXT", "STREAK", "BLOOM", "SNOWBALL", "HALO",
}


def parse_args():
    p = argparse.ArgumentParser(description="Download SPHEREx cutouts over time.")
    p.add_argument("ra", type=float, help="Right Ascension in degrees")
    p.add_argument("dec", type=float, help="Declination in degrees")
    p.add_argument("--size", type=float, default=0.1,
                   help="cutout size in degrees (default 0.1 = about 58 pixels)")
    p.add_argument("--max", type=int, default=20, help="max number of cutouts")
    p.add_argument("--out", default="data", help="output folder")
    p.add_argument("--deep", action="store_true",
                   help="also search the Deep Survey collections")
    p.add_argument("--detector", type=int, default=None,
                   help="keep only one detector (1-6). Same detector = similar wavelengths")
    p.add_argument("--png", action="store_true", help="also save PNG images + bad-pixel masks")
    p.add_argument("--subtract-zodi", action="store_true",
                   help="subtract the ZODI model from IMAGE before making PNGs")
    p.add_argument("--firefly", action="store_true",
                   help="show the first cutout in IRSA's Firefly web viewer")
    return p.parse_args()


def search_images(coord, deep):
    collections = ["spherex_dr1", "spherex_qr3"]
    if deep:
        collections += ["spherex_dr1_deep", "spherex_qr3_deep"]
    print("Searching collections:", ", ".join(collections))
    for attempt in range(4):  # IRSA's search sometimes answers 502/503 when busy
        try:
            results = Irsa.query_sia(pos=(coord, 1 * u.arcsec), collection=collections)
            break
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  search failed ({str(e)[:80]}...), retrying in {20 * (attempt + 1)}s")
            time.sleep(20 * (attempt + 1))
    results.sort("t_min")  # oldest first (t_min is MJD)
    return results


def cutout_url(access_url, ra, dec, size):
    base = str(access_url)
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}center={ra},{dec}&size={size}"


def open_with_retries(url, max_retries=3):
    """Same retry pattern as the tutorial. Reads all extensions into memory."""
    for attempt in range(max_retries):
        try:
            with fits.open(url, memmap=False) as hdulist:
                for hdu in hdulist:
                    hdu.data  # force load
                return fits.HDUList([hdu.copy() for hdu in hdulist])
        except (TimeoutError, urllib.error.HTTPError, urllib.error.URLError,
                http.client.IncompleteRead, OSError) as e:
            if attempt == max_retries - 1:
                raise
            wait = 10 * (attempt + 1)
            print(f"  retry {attempt + 1} in {wait}s ({e})")
            time.sleep(wait)


def flag_masks(hdulist):
    """Return (bad_mask, source_mask) as boolean arrays, using the FLAGS header names."""
    flags_hdu = hdulist["FLAGS"]
    flags = flags_hdu.data.astype(np.int64)
    hdr = flags_hdu.header
    bad_bits, source_bit = 0, 0
    for key in hdr["MSKN*"]:
        bit = int(key[4:])
        name = str(hdr[key]).strip()
        if name in BAD_FLAG_NAMES:
            bad_bits |= 1 << bit
        if name == "SOURCE":
            source_bit = 1 << bit
    bad = (flags & bad_bits) != 0
    source = (flags & source_bit) != 0 if source_bit else np.zeros_like(bad)
    return bad, source


def wavelength_at(hdulist, coord):
    """Wavelength and bandwidth (microns) at the target, via the spectral WCS (key='W')."""
    img_hdr = hdulist["IMAGE"].header
    x, y = WCS(img_hdr).world_to_pixel(coord)
    spectral_wcs = WCS(header=img_hdr, fobj=hdulist, key="W")
    spectral_wcs.sip = None  # SIP must be off for the spectral WCS (tutorial)
    wl, bw = spectral_wcs.pixel_to_world(x, y)
    return float(wl.to_value(u.um)), float(bw.to_value(u.um)), float(x), float(y)


def save_png(hdulist, bad, path_img, path_mask, subtract_zodi):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    data = hdulist["IMAGE"].data.astype(float)
    if subtract_zodi:
        # ZODI is a model of zodiacal light, NOT already removed from IMAGE (tutorial).
        # Subtracting it is our own step: same units (MJy/sr), so a plain difference.
        data = data - hdulist["ZODI"].data
    shown = np.where(bad, np.nan, data)
    lo, hi = np.nanpercentile(shown, [1, 99.5])  # simple contrast stretch
    plt.imsave(path_img, np.nan_to_num(shown, nan=lo), cmap="gray",
               vmin=lo, vmax=hi, origin="lower")
    plt.imsave(path_mask, bad.astype(float), cmap="gray", vmin=0, vmax=1, origin="lower")


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    coord = SkyCoord(a.ra, a.dec, unit="deg")

    results = search_images(coord, a.deep)
    print(f"Found {len(results)} SPHEREx images covering this position")
    if len(results) == 0:
        raise SystemExit("No images here. Try another position (SIA can lag ~1 day).")

    rows, saved = [], 0
    for i, row in enumerate(results):
        if saved >= a.max:
            break
        url = cutout_url(row["access_url"], a.ra, a.dec, a.size)
        try:
            hdulist = open_with_retries(url)
        except Exception as e:
            print(f"[{i}] skipped: {e}")
            continue

        hdr = hdulist["IMAGE"].header
        detector = hdr.get("DETECTOR")
        if a.detector is not None and detector != a.detector:
            continue

        # DATE-OBS = when the sky was observed. (DATE is only when IRSA wrote the file.)
        date = str(hdr.get("DATE-OBS", f"mjd{float(row['t_min']):.5f}"))
        stem = f"cutout_{saved:03d}_{date[:19].replace(':', '-')}"
        hdulist.writeto(os.path.join(a.out, stem + ".fits"), overwrite=True)

        bad, source = flag_masks(hdulist)
        try:
            wl, bw, x, y = wavelength_at(hdulist, coord)
        except Exception as e:  # keep going even if the spectral WCS can't be read
            print(f"  wavelength not read: {e}")
            wl = bw = x = y = float("nan")

        if a.png:
            save_png(hdulist, bad, os.path.join(a.out, stem + ".png"),
                     os.path.join(a.out, stem + "_mask.png"), a.subtract_zodi)

        rows.append({
            "file": stem + ".fits",
            "date": date,
            "t_min_mjd": float(row["t_min"]),
            "detector": detector,
            "obsid": hdr.get("OBSID"),
            "wavelength_um": round(wl, 4),
            "bandwidth_um": round(bw, 4),
            "target_x": round(x, 2),
            "target_y": round(y, 2),
            "psf_fwhm": hdr.get("PSF_FWHM"),
            "bad_pixel_frac": round(float(bad.mean()), 4),
            "source_pixel_frac": round(float(source.mean()), 4),
            "image_shape": "x".join(map(str, hdulist["IMAGE"].data.shape)),
            "url": url,
        })
        print(f"[{saved + 1}/{a.max}] {stem}  det={detector}  "
              f"wl={wl:.3f}um  bad={bad.mean():.1%}")
        saved += 1
        time.sleep(2)  # be gentle with IRSA; bursts get throttled

    if not rows:
        raise SystemExit("Nothing saved. Try without --detector, or another position.")

    with open(os.path.join(a.out, "index.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"Done. {len(rows)} cutouts + index.csv in '{a.out}/'")

    if a.firefly:
        # Open https://irsa.ipac.caltech.edu/irsaviewer in a browser tab first (tutorial).
        from firefly_client import FireflyClient
        fc = FireflyClient.make_client(url="https://irsa.ipac.caltech.edu/irsaviewer")
        fc.reinit_viewer()
        fc.show_fits_image(file_input=rows[0]["url"], plot_id="spectral_image",
                           Title=f"SPHEREx {rows[0]['date']}")
        print("Sent the first cutout to Firefly. Use the layers icon to overlay FLAGS.")


if __name__ == "__main__":
    main()