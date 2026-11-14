"""
Time-coloured "onion skin" of one sky spot, to make moving objects easy to spot.

The idea comes from onion-skinning in animation: take N consecutive moments, turn each
into a grayscale picture, tint each one a different colour, and stack them.
    - Stars don't move: they are in the same place in every frame, so the colours add up
      to WHITE (or BLACK on the light version).
    - A moving object (asteroid) is somewhere else in each frame, so it shows up as
      separate COLOURED dots, one colour per moment, in time order.

Why a "frame" is one burst and not all 102 bands
    SPHEREx images a spot in short bursts: about 4 exposures 2 minutes apart, 2 bands
    each (up to 8 bands per burst). Bursts repeat ~1.6 h (one orbit) or ~half a day later.
    Collecting all 102 bands takes weeks, but an asteroid crosses a 0.2 deg field in hours.
    So each frame merges only the bands of one burst into a "white light" grayscale image.

Steps
    1. Search IRSA for every SPHEREx image covering RA/Dec; group them into bursts.
    2. Pick N consecutive bursts: by default the N closest together in time, or --start.
    3. Download those cutouts (with retries; reused on re-runs).
    4. Per burst: subtract zodi + background, align every band to one north-up grid,
       divide each band by its noise, and average -> one grayscale frame.
    5. Colour each frame by time and stack, plus a few variations (see Output).

Setup
    pip install numpy scipy matplotlib astropy astroquery photutils

Usage
    python motion_frames.py RA DEC [options]
    python motion_frames.py 304.6935 42.4437
    # real moving objects, from easy to impossible (--track circles where JPL says it is
    # and prints its signal/noise in each frame):
    python motion_frames.py 13.2004 14.3800 --start 2025-07-09T17:00 --track 433         # Eros, near-Earth, fast + bright
    python motion_frames.py 184.3049 -6.3773 --start 2025-12-24T10:10 --track 624        # Hektor, Jupiter trojan
    python motion_frames.py 200.0075 21.5230 --start 2025-05-30T22:50 --min-spacing 10 --fov 0.1 --track 136472  # Makemake
    python motion_frames.py 26.3271 -0.4338 --start 2026-01-06T00:47 --min-spacing 20 --fov 0.1 --track 136199   # Eris
    --start must be a few minutes before the first burst you want (bursts are listed by
    their first exposure's start time).

Output (default folder data/motion_<RA>_<DEC>[_<start>]/)
    frame_1.png ... frame_N.png  grayscale frames, oldest first
    onion_dark.png       colours added on black: static stars white, movers coloured
    onion_light.png      like an animator's onion skin: on white, static stars dark,
                         movers coloured
    onion_noglow.png     onion_dark after removing star glow (top-hat, see deglow.py)
    onion_points.png     every star redrawn as a sharp dot, coloured by frame
    changes.png          each frame minus the median of all frames: stars cancel, only
                         things that changed remain (movers, flares, artifacts)
    blink.gif            the frames as a looping animation ("blink comparator")
    summary.png          everything above in one labelled figure, with a colour legend
    frames.csv           which images went into each frame, and when
"""
import argparse
import colorsys
import csv
import io
import os
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from astropy.time import Time

import deglow
from download import cutout_url, search_images
from spectral_bands import clean_band, fetch, grid_wcs, resample, unique_images


def parse_args():
    p = argparse.ArgumentParser(description="Time-coloured onion skin of one sky spot.")
    p.add_argument("ra", type=float, help="Right Ascension in degrees")
    p.add_argument("dec", type=float, help="Declination in degrees")
    p.add_argument("--frames", type=int, default=5, help="number of time frames (default 5)")
    p.add_argument("--start", default=None,
                   help="use the first burst at/after this UTC time, e.g. 2025-07-09T17:00 "
                        "(default: the N bursts closest together in time)")
    p.add_argument("--gap", type=float, default=15,
                   help="exposures less than this many minutes apart form one burst (default 15)")
    p.add_argument("--min-images", type=int, default=3,
                   help="skip bursts with fewer images that cover the whole field (default 3; "
                        "3+ lets the median remove cosmic-ray hits)")
    p.add_argument("--min-spacing", type=float, default=0,
                   help="hours between frames at least (default 0 = consecutive bursts). "
                        "Raise it for slow movers, e.g. 20 = about one frame per day")
    p.add_argument("--fov", type=float, default=0.2, help="field of view, degrees (default 0.2)")
    p.add_argument("--out", default=None, help="output folder")
    p.add_argument("--deep", action="store_true", help="also search the Deep Survey collections")
    p.add_argument("--workers", type=int, default=3,
                   help="parallel downloads (default 3; IRSA answers 503 to big bursts)")
    p.add_argument("--track", default=None,
                   help="known solar-system object (e.g. 433 or Ceres): mark where JPL Horizons "
                        "says it was in each frame, on summary.png")
    return p.parse_args()


# ---------------------------------------------------------------- 1-2. bursts
def covers_field(s_region, coord, half_deg):
    """True if the image footprint (SIA s_region polygon) contains all 4 corners of the field."""
    from matplotlib.path import Path
    nums = []
    for tok in str(s_region).split():
        try:
            nums.append(float(tok))
        except ValueError:
            pass
    ra, dec = np.array(nums[0::2]), np.array(nums[1::2])
    dx = ((ra - coord.ra.deg + 180) % 360 - 180) * np.cos(np.radians(coord.dec.deg))
    dy = dec - coord.dec.deg
    corners = [(sx * half_deg, sy * half_deg) for sx in (-1, 1) for sy in (-1, 1)]
    return bool(Path(np.column_stack([dx, dy])).contains_points(corners).all())


def group_bursts(images, gap_min):
    images = sorted(images, key=lambda r: r["mjd"])
    bursts, cur = [], [images[0]]
    for a, b in zip(images, images[1:]):
        if (b["mjd"] - a["mjd"]) * 1440 > gap_min:
            bursts.append(cur)
            cur = []
        cur.append(b)
    bursts.append(cur)
    return bursts


def pick_window(bursts, n, start, min_spacing_h=0.0):
    """n bursts in time order, each at least min_spacing_h after the previous one.
    With start: the first such chain beginning at/after start; else the shortest chain."""
    def chain(i0):
        sel = [i0]
        for j in range(i0 + 1, len(bursts)):
            if len(sel) == n:
                break
            if (bursts[j][0]["mjd"] - bursts[sel[-1]][0]["mjd"]) * 24 >= min_spacing_h:
                sel.append(j)
        return sel if len(sel) == n else None

    if start:
        t0 = Time(start).mjd
        i0 = next((i for i, b in enumerate(bursts) if b[0]["mjd"] >= t0), None)
        sel = chain(i0) if i0 is not None else None
        if sel is None:
            raise SystemExit(f"Not enough bursts after {start} (spacing {min_spacing_h} h).")
    else:
        chains = [c for c in (chain(i) for i in range(len(bursts))) if c]
        if not chains:
            raise SystemExit(f"Only {len(bursts)} usable bursts; ask for fewer --frames or less spacing.")
        sel = min(chains, key=lambda c: bursts[c[-1]][0]["mjd"] - bursts[c[0]][0]["mjd"])
    return [bursts[i] for i in sel]


# ---------------------------------------------------------------- 3. download
def download_image(img, ra, dec, size, folder):
    path = os.path.join(folder, f"{img['obs_id']}_D{img['detector']}.fits")
    if os.path.exists(path):
        return path
    data = fetch(cutout_url(img["url"], ra, dec, size))
    if not data.startswith(b"SIMPLE"):
        raise RuntimeError(f"not a FITS file: {data[:80]!r}")
    with fits.open(io.BytesIO(data)) as hdul:
        for hdu in hdul:
            hdu.data  # load before the buffer closes
        keep = fits.HDUList([hdu.copy() for hdu in hdul if hdu.name != "EPSF"])
    keep.writeto(path + ".part", overwrite=True)
    os.replace(path + ".part", path)
    return path


# ---------------------------------------------------------------- 4. frames
def noise_of(img):
    return sigma_clipped_stats(img[np.isfinite(img)], sigma=2.5)[2]


def build_frame(paths, sky):
    """Merge all bands of one burst: each band in signal-to-noise units, then combined.
    With 3+ images the median is used: a cosmic-ray hit is in only one exposure, while a
    real object (star or asteroid) is in all exposures of the burst, so the median keeps
    real objects and drops cosmic rays."""
    planes = []
    for p in paths:
        img, in_wcs, _ = clean_band(p)
        plane = resample(img, in_wcs, sky)
        if np.isfinite(plane).mean() > 0.2:
            planes.append(plane / noise_of(plane))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        frame = np.nanmedian(planes, axis=0) if len(planes) >= 3 else np.nanmean(planes, axis=0)
    return frame / noise_of(frame), len(planes)


# ---------------------------------------------------------------- 5. pictures
def time_colors(n):
    """n evenly spaced hues, red first. Their sum is nearly neutral (white)."""
    return np.array([colorsys.hsv_to_rgb(i / n, 1.0, 1.0) for i in range(n)])


def make_stretch(frames, lo_sigma=1.5, soften=20):
    """One stretch for all frames (in S/N units), so a constant star looks the same in each."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(np.stack(frames), axis=0)
    hi = max(float(np.nanpercentile(med, 99.8)), 5 * lo_sigma)

    def f(img):
        x = np.clip((img - lo_sigma) / (hi - lo_sigma), 0, 1)
        return np.nan_to_num(np.arcsinh(soften * x) / np.arcsinh(soften))
    return f


def onion_dark(grays, colors, gain=2.0):
    """Additive mix on black. Weights sum to white, so static stars -> white."""
    w = colors / colors.sum(axis=0)
    rgb = sum(g[..., None] * wi for g, wi in zip(grays, w))
    return np.clip(gain * rgb, 0, 1)


def onion_light(grays, colors):
    """Like ink on paper (multiply blend). Static stars -> dark, movers -> their colour."""
    rgb = np.ones(grays[0].shape + (3,))
    for g, c in zip(grays, colors):
        rgb *= 1 - g[..., None] * (1 - c)
    return rgb


def changes(frames, colors):
    """Each frame minus (scaled) median of all frames, shown from 3 sigma up, coloured by time."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(np.stack(frames), axis=0)
    bright = np.nan_to_num(med) > 20
    resid = []
    for f in frames:
        # bands differ between bursts, so star brightness differs a bit: match it first
        scale = np.nanmedian(f[bright] / med[bright]) if bright.sum() > 5 else 1.0
        r = f - scale * med
        resid.append(r / noise_of(r))
    hi = max(float(np.nanpercentile(np.concatenate([r[np.isfinite(r)] for r in resid]), 99.9)), 10)
    grays = [np.nan_to_num(np.clip((r - 3) / (hi - 3), 0, 1)) for r in resid]
    grays = [np.arcsinh(10 * g) / np.arcsinh(10) for g in grays]
    return onion_dark(grays, colors, gain=len(frames) / 2.0)


def points_layers(frames, upscale, nsigma=8):
    """Detect stars in each frame and redraw them as sharp dots (one gray layer per frame).
    A high threshold, so faint stars aren't found in some frames and missed in others."""
    found = []
    for f in frames:
        x, y = deglow.find_stars(f, nsigma=nsigma)
        found.append((x, y, deglow.measure(f, x, y)))
    allf = np.concatenate([fl for _, _, fl in found if len(fl)]) if any(len(fl) for _, _, fl in found) else np.array([1.0])
    ref = np.percentile(allf, 99)
    layers = []
    for x, y, fl in found:
        amp = deglow.soft_scale(fl, ref) if len(fl) else np.array([])
        layers.append(deglow.render_points(frames[0].shape, x, y, 0.45 + 0.55 * amp, upscale,
                                           (0.25 + 0.4 * amp) * upscale if len(fl) else None))
    return layers, [len(x) for x, _, _ in found]


def to_png(rgb, path, upscale):
    from PIL import Image
    a = rgb if rgb.ndim == 3 else np.repeat(rgb[..., None], 3, axis=2)
    img = Image.fromarray((np.clip(a, 0, 1)[::-1] * 255).astype(np.uint8))  # FITS row 0 = bottom
    if upscale > 1:
        img = img.resize((img.width * upscale, img.height * upscale), Image.BICUBIC)
    img.save(path)
    return np.asarray(img)


def save_gif(grays, colors, labels, path, upscale):
    from PIL import Image, ImageDraw
    images = []
    for g, c, label in zip(grays, colors, labels):
        im = Image.fromarray((g[::-1] * 255).astype(np.uint8)).convert("RGB")
        im = im.resize((im.width * upscale, im.height * upscale), Image.BICUBIC)
        draw = ImageDraw.Draw(im)
        draw.rectangle([0, 0, im.width - 1, 17], fill=(0, 0, 0))
        draw.text((5, 3), label, fill=tuple(int(255 * v) for v in c))
        images.append(im)
    images[0].save(path, save_all=True, append_images=images[1:], duration=700, loop=0)


def track_positions(name, mjds, out_wcs):
    """Pixel position of a known solar-system object at each time (JPL Horizons, geocentre)."""
    from astroquery.jplhorizons import Horizons
    eph = Horizons(id=name, id_type="smallbody", location="500",
                   epochs=[Time(m, format="mjd").jd for m in mjds]).ephemerides(quantities="1")
    x, y = out_wcs.world_to_pixel(SkyCoord(eph["RA"], eph["DEC"], unit="deg"))
    return np.asarray(x), np.asarray(y), str(eph["targetname"][0])


def save_summary(path, grays, colors, labels, panels, track, n_stars):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle
    n = len(grays)
    ncol = max(n, len(panels))
    fig, axes = plt.subplots(2, ncol, figsize=(3.2 * ncol, 7.0), facecolor="#111")
    h, w = grays[0].shape
    for ax in axes.flat:
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_facecolor("#111")
        for s in ax.spines.values():
            s.set_visible(False)
    for i, (g, c, label) in enumerate(zip(grays, colors, labels)):
        ax = axes[0][i]
        ax.imshow(g, cmap="gray", origin="lower", vmin=0, vmax=1)
        ax.set_title(label, color=c, fontsize=10)
        for s in ax.spines.values():
            s.set_visible(True)
            s.set_color(c)
            s.set_linewidth(3)
        if track is not None:
            tx, ty, _ = track
            if 0 <= tx[i] < w and 0 <= ty[i] < h:
                ax.add_patch(Circle((tx[i], ty[i]), 4, fill=False, color=c, lw=1.2))
    for j, (title, img) in enumerate(panels):
        ax = axes[1][j]
        ax.imshow(img, extent=(-0.5, w - 0.5, -0.5, h - 0.5))  # PNG already flipped
        ax.set_title(title, color="white", fontsize=10)
        if track is not None and title.startswith("onion (dark)"):
            tx, ty, _ = track
            for i in range(n):
                if 0 <= tx[i] < w and 0 <= ty[i] < h:
                    ax.add_patch(Circle((tx[i], ty[i]), 5, fill=False, color=colors[i], lw=1, ls="--"))
    title = "SPHEREx onion skin: one colour per moment in time (white = didn't move)"
    if track is not None:
        title += f"   |   circles: JPL position of {track[2]}"
    fig.suptitle(title, color="white", fontsize=12)
    fig.tight_layout()
    fig.savefig(path, dpi=90, facecolor=fig.get_facecolor())
    plt.close(fig)


# ---------------------------------------------------------------- main
def main():
    a = parse_args()
    coord = SkyCoord(a.ra, a.dec, unit="deg")
    tag = f"_{a.start[:10]}" if a.start else ""
    out = a.out or os.path.join("data", f"motion_{a.ra}_{a.dec}{tag}")
    img_dir = os.path.join(out, "images")
    os.makedirs(img_dir, exist_ok=True)
    size = round(a.fov * 1.5, 3)  # cutouts are rotated, so download a bit more than the fov

    results = search_images(coord, a.deep)
    meta = {str(r["access_url"]): (float(r["t_min"]), r["s_region"]) for r in results}
    images = [dict(img, mjd=meta[img["url"]][0]) for img in unique_images(results)]
    if not images:
        raise SystemExit("No SPHEREx images cover this position.")
    if a.start:
        # you chose the time: use every image, blank whatever isn't covered by all frames
        usable = images
        print(f"{len(images)} images cover the centre")
    else:
        # automatic: prefer images that contain the whole field (plus a small margin)
        usable = [img for img in images
                  if covers_field(meta[img["url"]][1], coord, a.fov / 2 + 0.01)]
        print(f"{len(images)} images; {len(usable)} cover the whole {a.fov} deg field")
    bursts = [b for b in group_bursts(usable, a.gap) if len(b) >= a.min_images] if usable else []
    print(f"{len(bursts)} bursts have {a.min_images}+ images")
    window = pick_window(bursts, a.frames, a.start, a.min_spacing)
    span_h = (window[-1][0]["mjd"] - window[0][0]["mjd"]) * 24
    print(f"Using {a.frames} bursts spanning {span_h:.1f} h:")
    for k, b in enumerate(window, 1):
        print(f"  frame {k}: {Time(b[0]['mjd'], format='mjd').iso[:16]} UTC, {len(b)} images")

    todo = [img for b in window for img in b]
    print(f"Downloading {len(todo)} cutouts ({size} deg)...")
    with ThreadPoolExecutor(a.workers) as pool:
        futures = {pool.submit(download_image, img, a.ra, a.dec, size, img_dir): img for img in todo}
        for fut in as_completed(futures):
            try:
                futures[fut]["path"] = fut.result()
            except Exception as e:
                print(f"  {futures[fut]['obs_id']} D{futures[fut]['detector']} failed: {e}")

    out_wcs, shape = grid_wcs(coord, a.fov)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    sky = out_wcs.pixel_to_world(xx, yy)
    frames, labels, mjds, rows = [], [], [], []
    for k, b in enumerate(window, 1):
        paths = [img["path"] for img in b if img.get("path")]
        if not paths:
            raise SystemExit(f"Frame {k}: no images downloaded.")
        dates = sorted(fits.getheader(p, "IMAGE")["DATE-OBS"] for p in paths)
        mjd = float(np.mean(Time(dates).mjd))
        frame, nb = build_frame(paths, sky)
        frames.append(frame)
        mjds.append(mjd)
        labels.append(f"{k}: {Time(mjd, format='mjd').iso[:16]}  ({nb} bands)")
        rows.append({"frame": k, "time_utc": Time(mjd, format="mjd").isot[:19], "n_bands": nb,
                     "files": " ".join(os.path.basename(p) for p in paths)})
    # Only compare where every frame has data; otherwise a star missing from one frame's
    # coverage would look like it changed.
    covered = np.all([np.isfinite(f) for f in frames], axis=0)
    frames = [np.where(covered, f, np.nan) for f in frames]
    if covered.mean() < 0.99:
        print(f"  {100 * (1 - covered.mean()):.0f}% of the field is not covered by every frame (blanked)")
    hdr = out_wcs.to_header()
    hdr["BUNIT"] = "S/N"
    hdr["COMMENT"] = "Plane k = frame k+1 (see frames.csv): merged bands in noise units."
    for k, m in enumerate(mjds, 1):
        hdr[f"MJD{k}"] = (m, f"mean time of frame {k}")
    fits.PrimaryHDU(np.array(frames, dtype=np.float32), header=hdr).writeto(
        os.path.join(out, "frames.fits"), overwrite=True)
    with open(os.path.join(out, "frames.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    up = max(2, round(480 / shape[0]))
    colors = time_colors(len(frames))
    st = make_stretch(frames)
    grays = [st(f) for f in frames]
    for k, g in enumerate(grays, 1):
        to_png(g, os.path.join(out, f"frame_{k}.png"), up)
    panels = [("onion (dark)", to_png(onion_dark(grays, colors), os.path.join(out, "onion_dark.png"), up)),
              ("onion (light)", to_png(onion_light(grays, colors), os.path.join(out, "onion_light.png"), up)),
              ("changes only", to_png(changes(frames, colors), os.path.join(out, "changes.png"), up))]

    hat = [deglow.tophat(np.nan_to_num(f), upscale=4) for f in frames]
    # top-hat output is never negative, so set black at sky median + 3 sigma instead of 1.5 sigma
    _, sky_med, sky_sd = sigma_clipped_stats(np.concatenate([h.ravel() for h in hat]), sigma=2.5)
    st_hat = make_stretch(hat, lo_sigma=sky_med + 3 * sky_sd)
    panels.append(("no glow (top-hat)",
                   to_png(onion_dark([st_hat(h) for h in hat], colors),
                          os.path.join(out, "onion_noglow.png"), max(1, up // 4))))
    layers, n_stars = points_layers(frames, upscale=8)
    panels.append(("stars as points",
                   to_png(onion_dark(layers, colors, gain=2.5), os.path.join(out, "onion_points.png"),
                          max(1, up // 8))))
    save_gif(grays, colors, labels, os.path.join(out, "blink.gif"), up)

    track = None
    if a.track:
        try:
            track = track_positions(a.track, mjds, out_wcs)
            for k, (tx, ty) in enumerate(zip(track[0], track[1]), 1):
                inside = 1 <= tx < shape[1] - 1 and 1 <= ty < shape[0] - 1
                if inside:
                    # brightest pixel within 1 px of the predicted spot (noise units), in this
                    # frame and (median) in the other frames: a real mover is bright only now,
                    # a background star is bright in every frame
                    ix, iy = int(round(tx)), int(round(ty))
                    peak = [np.nanmax(f[iy - 1:iy + 2, ix - 1:ix + 2]) for f in frames]
                    snr = peak[k - 1]
                    others = float(np.median(peak[:k - 1] + peak[k:]))
                    verdict = ("too faint to see" if snr - others < 4 else
                               "detected" if others < 3 else "detected, overlaps a star")
                    note = f"  signal/noise {snr:.1f} (other frames {others:.1f}) -> {verdict}"
                else:
                    note = "  (outside field)"
                print(f"  {track[2]} in frame {k}: pixel ({tx:.1f}, {ty:.1f}){note}")
        except Exception as e:
            print(f"Could not get JPL positions for {a.track}: {e}")
    save_summary(os.path.join(out, "summary.png"), grays, colors, labels, panels, track, n_stars)
    print(f"Done. Look at {out}/summary.png (stars found per frame: {n_stars})")


if __name__ == "__main__":
    main()
