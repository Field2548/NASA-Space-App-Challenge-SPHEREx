"""
Get all 102 SPHEREx bands for one sky position and merge them into pictures.

SPHEREx splits 0.75-5.0 um into 102 bands: 6 detectors x 17 channels. Each detector has a
"linear variable filter": the wavelength changes across the detector. Your spot lands on a
different part of the detector in every exposure, so every exposure sees it in a different
band. Collecting all 102 bands means picking the right exposures.

Steps
    1. Search IRSA for every SPHEREx image covering RA/Dec (same search as download.py).
    2. For each image, download only its header and wavelength table (HTTP range request,
       about 60 KB instead of the 60 MB file) and work out the wavelength at your spot.
    3. For each of the 102 bands, pick the image whose wavelength at your spot is closest
       to the band center. Band edges = 17 equal steps in log(wavelength) per detector.
    4. Download a cutout of each picked image (a few at a time, with retries).
    5. Subtract zodiacal light and leftover background, fill dead pixels, and line every
       band up on the same north-up pixel grid (each exposure is rotated differently).
    6. Save the results.

Setup
    pip install numpy scipy matplotlib astropy astroquery

Usage
    python spectral_bands.py RA DEC [options]
    python spectral_bands.py 304.6935 42.4437

Output (default folder data/bands_<RA>_<DEC>/)
    composite.png    one false-color image made from all bands:
                     blue = 0.75-1.64 um (D1+D2), green = 1.64-3.82 um (D3+D4),
                     red = 3.82-5.0 um (D5+D6)
    bands_grid.png   all 102 bands side by side, one row per detector, short to long
    cube.fits        the 102 aligned bands (MJy/sr) + a BANDS table, for your own code
    bands.csv        which image was used for each band, its wavelength and date
    scan.csv         wavelength at your spot for every image found (reused on re-runs)
    cutouts/         the downloaded cutouts (EPSF table dropped to save space)

Re-running is cheap: the scan and finished downloads are reused; only the pictures are remade.
"""
import argparse
import csv
import io
import math
import os
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import requests
from astropy import log
from astropy.convolution import Gaussian2DKernel, interpolate_replace_nans
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from astropy.table import Table
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

from download import cutout_url, search_images

log.setLevel("WARNING")  # hides astropy's long SIP INFO message for every spectral WCS

BLOCK = 2880          # FITS block size in bytes
PIXEL_SCALE = 6.15    # arcsec per SPHEREx pixel
N_CHAN = 17           # channels per detector
# Only used if IRSA returns no images at all for a detector (um).
NOMINAL_RANGE = {1: (0.75, 1.11), 2: (1.11, 1.64), 3: (1.64, 2.42),
                 4: (2.42, 3.82), 5: (3.82, 4.42), 6: (4.42, 5.00)}
# Hardware-dead pixels with no usable value; these get filled from their neighbors.
# Not included on purpose: TRANSIENT / SUR_ERROR / OUTLIER / BLOOM / OVERFLOW. They also fire
# on the cores of bright stars whose values are still fine, and blanking those turns a sharp
# star into a faint blob (or a hollow ring) in some bands but not others.
DEAD_FLAGS = {"NONFUNC", "HOT", "COLD", "MISSING_DATA"}
COLOR_GROUPS = {"red": (5, 6), "green": (3, 4), "blue": (1, 2)}


def parse_args():
    p = argparse.ArgumentParser(description="Get all 102 SPHEREx bands at one position and merge them.")
    p.add_argument("ra", type=float, help="Right Ascension in degrees")
    p.add_argument("dec", type=float, help="Declination in degrees")
    p.add_argument("--size", type=float, default=0.15,
                   help="cutout size to download, degrees (default 0.15)")
    p.add_argument("--fov", type=float, default=0.1,
                   help="size of the final aligned images, degrees (default 0.1 = 59 px). "
                        "Keep it below size/1.41 so every rotated cutout covers it")
    p.add_argument("--out", default=None, help="output folder (default data/bands_<RA>_<DEC>)")
    p.add_argument("--deep", action="store_true", help="also search the Deep Survey collections")
    p.add_argument("--workers", type=int, default=4,
                   help="parallel requests (default 4; IRSA throttles big bursts)")
    return p.parse_args()


# ---------------------------------------------------------------- HTTP helpers
_local = threading.local()


def fetch(url, byte_range=None, tries=6):
    """GET with retries. byte_range like '0-49151' or '-11520' (last N bytes)."""
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
    headers = {"Range": f"bytes={byte_range}"} if byte_range else {}
    for attempt in range(tries):
        try:
            with _local.session.get(url, headers=headers, timeout=180, stream=True) as r:
                if r.status_code in (429, 500, 502, 503, 504):
                    raise requests.HTTPError(f"HTTP {r.status_code}")
                r.raise_for_status()
                if byte_range and r.status_code != 206:
                    raise RuntimeError("server ignored the Range request")
                return r.content
        except requests.RequestException:
            if attempt == tries - 1:
                raise
            time.sleep(15 * (attempt + 1))  # IRSA answers 503 when busy; back off patiently


# ---------------------------------------------------------------- 1. search + scan
def unique_images(results):
    """One entry per (exposure, detector). If both DR1 and QR3 have it, keep DR1."""
    best = {}
    for row in results:
        det = int(str(row["energy_bandpassname"])[-1])  # 'SPHEREx-D4' -> 4
        coll = str(row["obs_collection"])
        key = (str(row["obs_id"]), det)
        rank = 0 if "_dr" in coll else 1
        if key not in best or rank < best[key]["rank"]:
            best[key] = {"url": str(row["access_url"]), "collection": coll, "rank": rank,
                         "obs_id": key[0], "detector": det}
    return list(best.values())


def scan_one(img, coord):
    """Wavelength at the target for one image, reading only its header + WCS-WAVE table."""
    url = img["url"]
    img_hdr = None
    for nbytes in (49152, 196608):  # IMAGE header is ~29 KB; fetch more if it is longer
        bio = io.BytesIO(fetch(url, f"0-{nbytes - 1}"))
        try:
            fits.Header.fromfile(bio)            # PRIMARY header (no data follows)
            img_hdr = fits.Header.fromfile(bio)  # IMAGE header
            break
        except Exception:
            continue
    if img_hdr is None:
        raise RuntimeError("could not read IMAGE header")
    tail = fetch(url, f"-{4 * BLOCK}")  # WCS-WAVE is the last, ~2-block extension
    start = tail.rfind(b"XTENSION= 'BINTABLE'")
    if start < 0:
        raise RuntimeError("WCS-WAVE table not found at end of file")
    wave = fits.open(io.BytesIO(fits.PrimaryHDU().header.tostring().encode() + tail[start:]))
    x, y = WCS(img_hdr).world_to_pixel(coord)
    spectral = WCS(header=img_hdr, fobj=wave, key="W")
    spectral.sip = None  # SIP must be off for the spectral WCS (IRSA tutorial)
    wl, bw = spectral.pixel_to_world(x, y)
    return {**{k: img[k] for k in ("url", "collection", "obs_id", "detector")},
            "date_obs": str(img_hdr.get("DATE-OBS", "")),
            "x": float(x), "y": float(y),
            "naxis1": int(img_hdr["NAXIS1"]), "naxis2": int(img_hdr["NAXIS2"]),
            "wavelength_um": float(wl.to_value("um")), "bandwidth_um": float(bw.to_value("um"))}


SCAN_TYPES = {"detector": int, "naxis1": int, "naxis2": int, "x": float, "y": float,
              "wavelength_um": float, "bandwidth_um": float}


def scan_all(images, coord, cache_path, workers):
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path, newline="") as f:
            for r in csv.DictReader(f):
                cache[r["url"]] = {k: SCAN_TYPES.get(k, str)(v) for k, v in r.items()}
    todo = [img for img in images if img["url"] not in cache]
    print(f"Reading headers of {len(todo)} images ({len(cache)} already in scan.csv)...")
    with ThreadPoolExecutor(workers) as pool:
        futures = {pool.submit(scan_one, img, coord): img for img in todo}
        for n, fut in enumerate(as_completed(futures), 1):
            try:
                s = fut.result()
                cache[s["url"]] = s
            except Exception as e:
                print(f"  skipped {futures[fut]['obs_id']} D{futures[fut]['detector']}: {e}")
            if n % 50 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)}")
    rows = list(cache.values())
    if rows:
        with open(cache_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    wanted = {img["url"] for img in images}
    return [s for s in rows if s["url"] in wanted]


# ---------------------------------------------------------------- 2. pick one image per band
def define_channels(results):
    """102 bands: per detector, 17 equal steps in log(wavelength) across its range."""
    channels = []
    for det in range(1, 7):
        sel = [str(b).endswith(f"D{det}") for b in results["energy_bandpassname"]]
        if any(sel):
            lo = float(np.nanmedian(np.ma.filled(results["em_min"][sel], np.nan))) * 1e6  # m -> um
            hi = float(np.nanmedian(np.ma.filled(results["em_max"][sel], np.nan))) * 1e6
        else:
            lo, hi = NOMINAL_RANGE[det]
        edges = lo * (hi / lo) ** (np.arange(N_CHAN + 1) / N_CHAN)
        for k in range(N_CHAN):
            channels.append({"band": (det - 1) * N_CHAN + k + 1, "detector": det,
                             "lo_um": edges[k], "hi_um": edges[k + 1],
                             "center_um": math.sqrt(edges[k] * edges[k + 1]), "frame": None})
    return channels


def pick_frames(channels, scanned, margin_px):
    for ch in channels:
        candidates = [s for s in scanned
                      if s["detector"] == ch["detector"]
                      and ch["lo_um"] <= s["wavelength_um"] < ch["hi_um"]
                      and margin_px <= s["x"] <= s["naxis1"] - 1 - margin_px
                      and margin_px <= s["y"] <= s["naxis2"] - 1 - margin_px]
        ch["frame"] = min(candidates, default=None,
                          key=lambda s: abs(math.log(s["wavelength_um"] / ch["center_um"])))


# ---------------------------------------------------------------- 3. download
def download_cutout(ch, ra, dec, size, folder):
    f = ch["frame"]
    path = os.path.join(folder, f"band{ch['band']:03d}_D{f['detector']}_{f['wavelength_um']:.3f}um.fits")
    if os.path.exists(path):
        return path
    data = fetch(cutout_url(f["url"], ra, dec, size))
    if not data.startswith(b"SIMPLE"):
        raise RuntimeError(f"not a FITS file: {data[:80]!r}")
    with fits.open(io.BytesIO(data)) as hdul:
        for hdu in hdul:
            hdu.data  # load before the buffer closes
        keep = fits.HDUList([hdu.copy() for hdu in hdul if hdu.name != "EPSF"])
    keep.writeto(path + ".part", overwrite=True)
    os.replace(path + ".part", path)
    return path


# ---------------------------------------------------------------- 4. clean + align
def dead_mask(flags_hdu):
    flags = flags_hdu.data.astype(np.int64)
    hdr = flags_hdu.header
    bits = 0
    for key in hdr["MSKN*"]:
        if str(hdr[key]).strip() in DEAD_FLAGS:
            bits |= 1 << int(key[4:])
    return (flags & bits) != 0


def clean_band(path):
    """Cutout IMAGE minus zodi and leftover background, dead pixels filled.
    Returns (image on the cutout's own pixel grid, its celestial WCS, dead-pixel fraction)."""
    with fits.open(path) as hdul:
        img = hdul["IMAGE"].data.astype(float) - hdul["ZODI"].data
        dead = dead_mask(hdul["FLAGS"]) | ~np.isfinite(img)
        in_wcs = WCS(hdul["IMAGE"].header)
    img[dead] = np.nan
    img -= sigma_clipped_stats(img[np.isfinite(img)])[1]  # leftover background (median) -> 0
    img = interpolate_replace_nans(img, Gaussian2DKernel(1))  # fill dead pixels
    return img, in_wcs, float(dead.mean())


def resample(img, in_wcs, sky):
    """Resample an image onto the common north-up grid `sky` (bilinear; NaN outside)."""
    x_in, y_in = in_wcs.world_to_pixel(sky)
    return map_coordinates(img, [y_in, x_in], order=1, cval=np.nan)


def aligned_band(path, sky):
    """Zodi- and background-subtracted band, resampled onto the common grid `sky`."""
    img, in_wcs, dead_frac = clean_band(path)
    return resample(img, in_wcs, sky), dead_frac


def grid_wcs(coord, fov):
    half = int(round(fov * 3600 / PIXEL_SCALE / 2))
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [coord.ra.deg, coord.dec.deg]
    w.wcs.crpix = [half + 1, half + 1]  # target in the center pixel
    w.wcs.cdelt = [-PIXEL_SCALE / 3600, PIXEL_SCALE / 3600]  # north up, east left
    return w, (2 * half + 1, 2 * half + 1)


# ---------------------------------------------------------------- 5. pictures
def stretch(img, lo_pct=5, hi_pct=99.7, soften=50):
    """asinh stretch to 0..1, so faint stars and bright stars both show."""
    good = img[np.isfinite(img)]
    if good.size == 0:
        return np.zeros_like(img)
    lo, hi = np.percentile(good, [lo_pct, hi_pct])
    x = np.clip((img - lo) / max(hi - lo, 1e-12), 0, 1)
    return np.nan_to_num(np.arcsinh(soften * x) / np.arcsinh(soften))


def save_composite(cube, channels, path, upscale=8):
    from PIL import Image
    planes = []
    for name, dets in COLOR_GROUPS.items():  # red, green, blue
        idx = [i for i, ch in enumerate(channels) if ch["detector"] in dets and ch.get("path")]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels
            # Median, not mean: cosmic-ray hits, ghosts and asteroids sit in only one or two
            # of the ~34 bands per color, so the median ignores them.
            planes.append(stretch(np.nanmedian(cube[idx], axis=0)))
    rgb = (np.dstack(planes)[::-1] * 255).astype(np.uint8)  # flip: FITS row 0 is the bottom
    h, w = rgb.shape[:2]
    Image.fromarray(rgb).resize((w * upscale, h * upscale), Image.BICUBIC).save(path)


def save_grid(cube, channels, path, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(6, N_CHAN, figsize=(N_CHAN * 1.0, 6 * 1.0 + 0.6), facecolor="#111")
    for i, ch in enumerate(channels):
        ax = axes[ch["detector"] - 1][(ch["band"] - 1) % N_CHAN]
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        if ch.get("path"):
            ax.imshow(stretch(cube[i]), cmap="gray", origin="lower", vmin=0, vmax=1,
                      interpolation="nearest")
            label = f"{ch['frame']['wavelength_um']:.2f}"
        else:
            ax.set_facecolor("#2a2a2a")
            label = f"{ch['center_um']:.2f}\nno data"
        ax.text(0.04, 0.04, label, transform=ax.transAxes, fontsize=7, color="white",
                va="bottom", bbox=dict(facecolor="black", alpha=0.6, pad=1, linewidth=0))
    for det in range(1, 7):
        axes[det - 1][0].set_ylabel(f"D{det}", color="white", rotation=0, labelpad=12, va="center")
    fig.suptitle(title, color="white", fontsize=12)
    fig.subplots_adjust(left=0.03, right=0.995, top=0.92, bottom=0.01, wspace=0.03, hspace=0.03)
    fig.savefig(path, dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)


# ---------------------------------------------------------------- main
def main():
    a = parse_args()
    coord = SkyCoord(a.ra, a.dec, unit="deg")
    out = a.out or os.path.join("data", f"bands_{a.ra}_{a.dec}")
    cut_dir = os.path.join(out, "cutouts")
    os.makedirs(cut_dir, exist_ok=True)
    if a.fov > a.size / math.sqrt(2):
        print(f"Warning: --fov {a.fov} > --size/1.41; image corners may be blank in some bands.")

    # 1. search + scan
    results = search_images(coord, a.deep)
    images = unique_images(results)
    print(f"Found {len(results)} images ({len(images)} unique exposure+detector pairs)")
    if not images:
        raise SystemExit("No SPHEREx images cover this position.")
    scanned = scan_all(images, coord, os.path.join(out, "scan.csv"), a.workers)

    # 2. pick
    channels = define_channels(results)
    pick_frames(channels, scanned, margin_px=a.size * 3600 / PIXEL_SCALE / 2 + 2)
    todo = [ch for ch in channels if ch["frame"]]
    missing = [ch["band"] for ch in channels if not ch["frame"]]
    print(f"Bands with an image: {len(todo)}/102" + (f"  (missing: {missing})" if missing else ""))

    # 3. download
    print(f"Downloading {len(todo)} cutouts ({a.size} deg) to {cut_dir} ...")
    with ThreadPoolExecutor(a.workers) as pool:
        futures = {pool.submit(download_cutout, ch, a.ra, a.dec, a.size, cut_dir): ch for ch in todo}
        for n, fut in enumerate(as_completed(futures), 1):
            ch = futures[fut]
            try:
                ch["path"] = fut.result()
                print(f"  [{n}/{len(todo)}] band {ch['band']:3d}  D{ch['detector']}  "
                      f"{ch['frame']['wavelength_um']:.3f} um  {ch['frame']['date_obs'][:10]}")
            except Exception as e:
                print(f"  [{n}/{len(todo)}] band {ch['band']} FAILED: {e}")

    # 4. align
    out_wcs, shape = grid_wcs(coord, a.fov)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    sky = out_wcs.pixel_to_world(xx, yy)
    cube = np.full((len(channels), *shape), np.nan, dtype=np.float32)
    for i, ch in enumerate(channels):
        if ch.get("path"):
            cube[i], ch["dead_frac"] = aligned_band(ch["path"], sky)

    # 5. save
    rows = [{"band": ch["band"], "detector": ch["detector"],
             "band_lo_um": round(ch["lo_um"], 4), "band_hi_um": round(ch["hi_um"], 4),
             "wavelength_um": round(ch["frame"]["wavelength_um"], 4) if ch.get("path") else "",
             "bandwidth_um": round(ch["frame"]["bandwidth_um"], 4) if ch.get("path") else "",
             "date_obs": ch["frame"]["date_obs"] if ch.get("path") else "",
             "obs_id": ch["frame"]["obs_id"] if ch.get("path") else "",
             "dead_pixel_frac": round(ch["dead_frac"], 4) if ch.get("path") else "",
             "file": os.path.basename(ch["path"]) if ch.get("path") else ""}
            for ch in channels]
    with open(os.path.join(out, "bands.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    hdr = out_wcs.to_header()
    hdr["BUNIT"] = "MJy/sr"
    hdr["COMMENT"] = "Plane i = SPHEREx band i+1 (see BANDS table). NaN plane = no data."
    hdr["COMMENT"] = "Zodiacal light and median background subtracted; dead pixels filled."
    table = Table([[r[k] if r[k] != "" else np.nan for r in rows]
                   for k in ("band", "detector", "band_lo_um", "band_hi_um",
                             "wavelength_um", "bandwidth_um")],
                  names=("BAND", "DETECTOR", "BAND_LO_UM", "BAND_HI_UM",
                         "WAVELENGTH_UM", "BANDWIDTH_UM"))
    table["DATE_OBS"] = [r["date_obs"] for r in rows]
    bands_hdu = fits.table_to_hdu(table)
    bands_hdu.name = "BANDS"
    fits.HDUList([fits.PrimaryHDU(cube, header=hdr),
                  bands_hdu]).writeto(os.path.join(out, "cube.fits"), overwrite=True)

    done = sum(1 for ch in channels if ch.get("path"))
    save_composite(cube, channels, os.path.join(out, "composite.png"))
    save_grid(cube, channels, os.path.join(out, "bands_grid.png"),
              f"SPHEREx: {done} of 102 bands at RA {a.ra}, Dec {a.dec}  (wavelength in um)")
    dates = sorted(ch["frame"]["date_obs"] for ch in channels if ch.get("path"))
    print(f"Done. {done}/102 bands, observed {dates[0][:10]} to {dates[-1][:10]}.")
    print(f"  {out}/composite.png, bands_grid.png, cube.fits, bands.csv")


if __name__ == "__main__":
    main()
