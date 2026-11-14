"""
Remove the "glow" around stars in SPHEREx images so stars become small, sharp points.

Where the glow comes from
    1. The telescope's PSF spreads every star's light over its neighbours (FWHM ~1.2-1.5 px)
       plus faint, wider wings.
    2. The asinh stretch that makes faint stars visible also brightens those faint wings.
    3. Smooth (bicubic) upscaling of the small images blurs them further.

Three techniques (compare them with:  python deglow.py data/bands_304.6935_42.4437)
    richardson_lucy  Deconvolution: undo the PSF blur using the PSF itself. The standard
                     astronomy method (it was used to repair early Hubble images). Keeps faint
                     objects and nebulae; can leave thin dark rings around very bright stars.
    tophat           Morphological white top-hat: keep only features smaller than a small
                     disk, so broad halos go. Fast, but it also removes nebulae and dims cores.
    rerender_stars   Find every star (photutils DAOStarFinder), measure its position and
                     brightness, and redraw it as a sharp dot on a black sky. No glow at all and
                     sub-pixel positions, but anything that is not a point (nebulae) is dropped.

Writes, in the bands folder:
    composite_deconvolved.png, composite_tophat.png, composite_points.png
    glow_comparison.png   all four side by side, plus a zoom on the brightest star
"""
import csv
import os
import sys
import warnings

import numpy as np
from astropy.io import fits
from astropy.stats import mad_std
from astropy.wcs import WCS
from scipy.ndimage import white_tophat
from scipy.signal import fftconvolve

PIXEL_SCALE = 6.15  # arcsec per SPHEREx pixel


# ---------------------------------------------------------------- PSFs
def gaussian_psf(fwhm_px, size=9):
    y, x = np.mgrid[:size, :size] - size // 2
    s = fwhm_px / 2.3548
    p = np.exp(-(x ** 2 + y ** 2) / (2 * s ** 2))
    return p / p.sum()


def epsf_to_native(epsf, oversample=5):
    """Bin a SPHEREx EPSF (33x33 at 5x oversampling) down to native pixels (7x7)."""
    n = epsf.shape[0]
    m = -(-n // oversample)
    m += (m + 1) % 2                       # odd number of native pixels, centred
    pad = (m * oversample - n) // 2
    p = np.pad(epsf, pad)
    native = p.reshape(m, oversample, m, oversample).sum(axis=(1, 3))
    return native / native.sum()


def psf_for(path):
    """Best PSF for a saved cutout: its PSF extension if present, else a Gaussian of PSF_FWHM."""
    with fits.open(path) as hdul:
        if "PSF" in hdul:
            return epsf_to_native(hdul["PSF"].data.astype(float), hdul["PSF"].header.get("OVSMPX", 5))
        return gaussian_psf(hdul["IMAGE"].header["PSF_FWHM"] / PIXEL_SCALE)


# ---------------------------------------------------------------- techniques
def richardson_lucy(img, psf, iterations=20):
    """Richardson-Lucy deconvolution. NaNs are kept as NaN."""
    finite = np.isfinite(img)
    data = np.where(finite, img, 0.0)
    noise = mad_std(data[finite])
    offset = noise - min(float(data.min()), 0.0)  # RL needs positive data: add a flat pedestal
    pad = psf.shape[0]
    d = np.pad(data + offset, pad, mode="reflect")
    est = np.full_like(d, d.mean())
    psf_flip = psf[::-1, ::-1]
    for _ in range(iterations):
        blurred = fftconvolve(est, psf, mode="same")
        est *= fftconvolve(d / np.maximum(blurred, 1e-12), psf_flip, mode="same")
    out = est[pad:-pad, pad:-pad] - offset
    out -= np.median(out[finite])  # re-level the background
    out[~finite] = np.nan
    return out


def tophat(img, radius=2.5, upscale=4):
    """White top-hat: image minus its morphological opening by a disk, which keeps only bright
    features smaller than the disk (star cores) and removes anything broader (halos, nebulae).
    Done on a smoothly upscaled copy so the disk is round and stars stay round.
    Returns an image `upscale` times larger."""
    from scipy.ndimage import zoom
    big = zoom(np.nan_to_num(img), upscale, order=3)
    r = radius * upscale
    n = int(np.ceil(r))
    y, x = np.mgrid[-n:n + 1, -n:n + 1]
    return white_tophat(big, footprint=x ** 2 + y ** 2 <= r ** 2)


def find_stars(img, nsigma=5.0):
    """Point sources in a background-subtracted image -> (x, y) arrays (0-based pixels).
    Local peaks above nsigma x noise, then a quadratic centroid for sub-pixel positions.
    (DAOStarFinder's shape filters reject too many stars here: SPHEREx stars are only
    1-2 px wide and often blended.)"""
    from astropy.stats import sigma_clipped_stats
    from photutils.centroids import centroid_quadratic
    from photutils.detection import find_peaks
    data = np.nan_to_num(img)
    noise = sigma_clipped_stats(data, sigma=2.5)[2]  # ignores stars, unlike a plain std/MAD
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # "no sources found" warning
        tbl = find_peaks(data, threshold=nsigma * noise, box_size=3, border_width=1,
                         centroid_func=centroid_quadratic)
    if tbl is None:
        return np.array([]), np.array([])
    x = np.asarray(tbl["x_centroid"], float)
    y = np.asarray(tbl["y_centroid"], float)
    px, py = np.asarray(tbl["x_peak"], float), np.asarray(tbl["y_peak"], float)
    bad = ~np.isfinite(x) | ~np.isfinite(y) | (np.hypot(x - px, y - py) > 1)  # failed fits
    x[bad], y[bad] = px[bad], py[bad]
    return x, y


def measure(img, x, y, r=1.5):
    """Aperture flux of each star in a linear image."""
    from photutils.aperture import CircularAperture, aperture_photometry
    if len(x) == 0:
        return np.array([])
    ap = CircularAperture(np.column_stack([x, y]), r=r)
    return np.asarray(aperture_photometry(np.nan_to_num(img), ap)["aperture_sum"])


def render_points(shape, x, y, amp, upscale=8, size=None):
    """Draw each star as a small sharp Gaussian dot on a black canvas `upscale` times larger.
    amp: 0..1 brightness per star; size: dot sigma in output pixels (default grows with amp)."""
    h, w = shape
    canvas = np.zeros((h * upscale, w * upscale))
    if size is None:
        size = 0.9 + 2.2 * np.clip(amp, 0, 1)
    yy, xx = np.mgrid[:h * upscale, :w * upscale]
    for xi, yi, a, s in zip(x, y, amp, np.broadcast_to(size, np.shape(amp))):
        cx, cy = (xi + 0.5) * upscale - 0.5, (yi + 0.5) * upscale - 0.5
        r = int(4 * s) + 1
        x0, x1 = max(int(cx) - r, 0), min(int(cx) + r + 1, w * upscale)
        y0, y1 = max(int(cy) - r, 0), min(int(cy) + r + 1, h * upscale)
        if x0 >= x1 or y0 >= y1:
            continue
        sx, sy = xx[y0:y1, x0:x1], yy[y0:y1, x0:x1]
        dot = a * np.exp(-((sx - cx) ** 2 + (sy - cy) ** 2) / (2 * s ** 2))
        canvas[y0:y1, x0:x1] = np.maximum(canvas[y0:y1, x0:x1], dot)
    return canvas


def soft_scale(values, ref, soften=50):
    """asinh brightness 0..1 for values relative to `ref` (same curve as spectral_bands.stretch)."""
    x = np.clip(np.asarray(values) / max(ref, 1e-12), 0, 1)
    return np.arcsinh(soften * x) / np.arcsinh(soften)


def points_rgb(shape, x, y, fluxes, upscale=8, floor=0.45):
    """Redraw stars as sharp coloured dots. fluxes: one array per colour channel (R, G, B).
    Brightness: asinh of total flux with a floor so faint stars stay visible; dot size grows
    with brightness; colour = each channel's own asinh-scaled flux, as in the composite."""
    if len(x) == 0:
        return [np.zeros((shape[0] * upscale, shape[1] * upscale))] * 3
    per_chan = np.array([soft_scale(f, np.percentile(f, 99)) for f in fluxes])  # (3, n)
    color = per_chan / np.maximum(per_chan.max(axis=0), 1e-12)
    total = soft_scale(np.sum(fluxes, axis=0), np.percentile(np.sum(fluxes, axis=0), 99))
    level = floor + (1 - floor) * total
    size = (0.2 + 0.45 * total) * upscale  # dot sigma: 0.2-0.65 native pixels
    return [render_points(shape, x, y, level * color[c], upscale, size) for c in range(3)]


# ---------------------------------------------------------------- 102-band comparison
def channel_images(cube, detectors, groups):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return [np.nanmedian(cube[[i for i, d in enumerate(detectors) if d in g]], axis=0)
                for g in groups]


def rgb_png(planes, path=None, upscale=8, already_scaled=False):
    """Stretch 3 planes (R, G, B), flip to image orientation, upscale, optionally save.
    already_scaled=True: planes are 0..1 and already at final size (rendered points)."""
    from PIL import Image
    from spectral_bands import stretch
    chans = planes if already_scaled else [stretch(p) for p in planes]
    rgb = (np.clip(np.dstack(chans), 0, 1)[::-1] * 255).astype(np.uint8)
    img = Image.fromarray(rgb)
    if not already_scaled:
        img = img.resize((rgb.shape[1] * upscale, rgb.shape[0] * upscale), Image.BICUBIC)
    if path:
        img.save(path)
    return np.asarray(img)


def main(folder):
    from spectral_bands import COLOR_GROUPS, clean_band, resample
    rows = [r for r in csv.DictReader(open(os.path.join(folder, "bands.csv"))) if r["file"]]
    with fits.open(os.path.join(folder, "cube.fits")) as hdul:
        out_wcs = WCS(hdul[0].header).celestial
        cube_all = hdul[0].data.astype(float)
        bands = list(hdul["BANDS"].data["BAND"])
    cube = np.stack([cube_all[bands.index(int(r["band"]))] for r in rows])
    detectors = [int(r["detector"]) for r in rows]
    shape = cube.shape[1:]
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    sky = out_wcs.pixel_to_world(xx, yy)
    groups = list(COLOR_GROUPS.values())  # red, green, blue

    print("Deconvolving 102 bands (Richardson-Lucy, PSF from each band's PSF_FWHM)...")
    cube_rl = np.empty_like(cube)
    for i, r in enumerate(rows):
        path = os.path.join(folder, "cutouts", r["file"])
        img, in_wcs, _ = clean_band(path)
        cube_rl[i] = resample(richardson_lucy(img, psf_for(path)), in_wcs, sky)

    orig = channel_images(cube, detectors, groups)
    deconv = channel_images(cube_rl, detectors, groups)
    hat = [tophat(p, upscale=4) for p in orig]

    # redraw stars as points: detect on the white-light (sum of S/N) image, measure colour on
    # the original channels
    white = sum(p / mad_std(p[np.isfinite(p)]) for p in orig)
    x, y = find_stars(white)
    pts = points_rgb(shape, x, y, [measure(p, x, y) for p in orig])
    print(f"Found {len(x)} stars for the redrawn-points version")

    out = {}
    out["original"] = rgb_png(orig)  # same as composite.png
    out["deconvolved (Richardson-Lucy)"] = rgb_png(deconv, os.path.join(folder, "composite_deconvolved.png"))
    out["top-hat"] = rgb_png(hat, os.path.join(folder, "composite_tophat.png"), upscale=2)
    out["redrawn points"] = rgb_png(pts, os.path.join(folder, "composite_points.png"), already_scaled=True)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    # zoom box around the brightest star (in the upscaled 8x images)
    lum = sum(orig)
    sy, sx = np.unravel_index(np.nanargmax(lum), lum.shape)
    up = out["original"].shape[0] // shape[0]
    cy, cx = (shape[0] - 1 - sy) * up + up // 2, sx * up + up // 2  # PNG rows are flipped
    half = 14 * up
    fig, axes = plt.subplots(2, 4, figsize=(16, 8.4), facecolor="#111")
    for col, (name, im) in enumerate(out.items()):
        axes[0][col].imshow(im)
        axes[0][col].set_title(name, color="white", fontsize=13)
        crop = im[max(cy - half, 0):cy + half, max(cx - half, 0):cx + half]
        axes[1][col].imshow(crop)
        axes[1][col].set_title("zoom on brightest star", color="#aaa", fontsize=10)
        for ax in (axes[0][col], axes[1][col]):
            ax.set_xticks([])
            ax.set_yticks([])
    fig.tight_layout()
    fig.savefig(os.path.join(folder, "glow_comparison.png"), dpi=80, facecolor=fig.get_facecolor())
    print(f"Wrote composite_deconvolved/tophat/points.png and glow_comparison.png in {folder}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "bands_304.6935_42.4437"))
