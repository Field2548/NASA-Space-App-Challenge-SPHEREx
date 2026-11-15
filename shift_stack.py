"""
Digital tracking ("shift-and-stack"): find moving objects too faint to see in any single frame.

Guess an object's motion (vx, vy), shift every frame back along that guess, and add them up.
For the right guess the object lands on the same pixel in every frame, so its signal adds up
(S/N grows ~ sqrt(number of frames)) while the noise does not. Try every plausible motion and
keep the best. This is how faint asteroids and Kuiper Belt objects are discovered today:
    Heinze, Metchev & Trollo 2015, AJ 150, 125: "digital tracking" finds asteroids ~10x fainter
        than conventional searches.  https://arxiv.org/abs/1508.01599
    Whidden et al. 2019 (KBMOD): GPU shift-and-stack for slow Kuiper Belt objects.
        https://arxiv.org/abs/1901.02492
Before stacking, stars are removed with leave-one-out difference images (motion_frames.residuals),
and each frame's contribution is capped at +-4 sigma so one cosmic ray can't fake a detection.

False alarms: the same search is run on the sign-flipped difference images. Real objects are
positive, so whatever the flipped search finds is noise or artifacts; its highest peak is the
honest bar a real candidate must clear.

Usage (on a folder made by motion_frames.py)
    python shift_stack.py data/motion_26.3271_-0.4338_2026-01-06                 # blind search
    python shift_stack.py data/motion_26.3271_-0.4338_2026-01-06 --track 136199  # + JPL check
    --vmax PX_PER_DAY  fastest motion to try (default 10 px/day = ~60"/day; Hektor needs ~60)

Output (same folder)
    stack_search.png   best-motion S/N map with candidates, the noise-only map, the image
                       stacked along candidate 1 (mover = sharp dot, stars = trails), a
                       "co-moving onion" (mover white, stars rainbow trails) and stamps
    candidates.csv     candidates: position, motion, stacked S/N, S/N in each frame
"""
import argparse
import csv
import os
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import binary_dilation, maximum_filter

from motion_frames import (matched_filter, onion_dark, residuals, time_colors, to_png,
                           track_positions)


def parse_args():
    p = argparse.ArgumentParser(description="Shift-and-stack search for faint moving objects.")
    p.add_argument("folder", help="output folder of motion_frames.py (needs frames.fits)")
    p.add_argument("--vmax", type=float, default=10.0, help="fastest motion to try, px/day (default 10)")
    p.add_argument("--min-move", type=float, default=4.0,
                   help="ignore motions shorter than this over the whole span, px (default 4, about "
                        "2.5 star widths): slower 'motion' can't be told apart from a variable star")
    p.add_argument("--threshold", type=float, default=6.0, help="report candidates above this S/N")
    p.add_argument("--clip", type=float, default=4.0,
                   help="cap each frame's contribution at +-CLIP sigma before stacking (default 4), so "
                        "one cosmic ray or artifact can't make a candidate on its own (KBMOD does "
                        "the same with outlier rejection along each trajectory)")
    p.add_argument("--mask-above", type=float, default=20.0,
                   help="mask around static stars brighter than this S/N (default 20): their "
                        "imperfect subtraction is the main source of fake candidates")
    p.add_argument("--track", default=None, help="known object (e.g. 136199) to compare with JPL")
    p.add_argument("--matched-filter", action="store_true",
                   help="PSF matched-filter frames first (off by default; it lowered S/N on SPHEREx)")
    return p.parse_args()


def search(R, t, vmax, min_move):
    """Best stacked S/N over all motions, per pixel at the reference time.
    R: (N, H, W) difference images in noise units; t: frame times in days from the reference."""
    n, h, w = R.shape
    span = t.max() - t.min()
    step = 1.0 / span                         # worst position error at the end frames ~0.25 px
    pad = int(np.ceil(vmax * np.abs(t).max())) + 2
    Rp = np.full((n, h + 2 * pad, w + 2 * pad), np.nan)
    Rp[:, pad:pad + h, pad:pad + w] = R
    best = np.full((h, w), -np.inf)
    best_v = np.zeros((h, w, 2))
    seen = set()
    vs = np.arange(-vmax, vmax + step / 2, step)
    for vx in vs:
        for vy in vs:
            if np.hypot(vx, vy) * span < min_move:
                continue
            sx = np.round(vx * t).astype(int)
            sy = np.round(vy * t).astype(int)
            key = tuple(sx) + tuple(sy)       # many velocities give the same integer shifts
            if key in seen:
                continue
            seen.add(key)
            stack = np.stack([Rp[k, pad + sy[k]:pad + sy[k] + h, pad + sx[k]:pad + sx[k] + w]
                              for k in range(n)])
            good = np.isfinite(stack)
            cnt = good.sum(axis=0)
            score = np.where(cnt >= n - 1, np.nansum(stack, axis=0) / np.sqrt(np.maximum(cnt, 1)), -np.inf)
            better = score > best
            best[better] = score[better]
            best_v[better] = (vx, vy)
    return best, best_v, len(seen)


def peaks(best, best_v, threshold, top=10):
    b = np.where(np.isfinite(best), best, -np.inf)
    ys, xs = np.nonzero((b == maximum_filter(b, size=5)) & (b >= threshold))
    out = []
    for i in np.argsort(-b[ys, xs]):
        x, y = int(xs[i]), int(ys[i])
        if any(np.hypot(x - c[0], y - c[1]) < 4 for c in out):  # same object, tied scores
            continue
        out.append((x, y, float(b[y, x]), *best_v[y, x]))
        if len(out) == top:
            break
    return out


def shifted(frames, t, vx, vy):
    """Frames shifted so an object moving at (vx, vy) px/day stays still (integer shifts)."""
    n, h, w = frames.shape
    out = np.full_like(frames, np.nan)
    for k in range(n):
        sx, sy = int(round(vx * t[k])), int(round(vy * t[k]))
        ys, yd = (slice(sy, h), slice(0, h - sy)) if sy >= 0 else (slice(0, h + sy), slice(-sy, h))
        xs, xd = (slice(sx, w), slice(0, w - sx)) if sx >= 0 else (slice(0, w + sx), slice(-sx, w))
        out[k, yd, xd] = frames[k, ys, xs]
    return out


def main():
    a = parse_args()
    hdul = fits.open(os.path.join(a.folder, "frames.fits"))
    hdr = hdul[0].header
    raw = hdul[0].data.astype(float)
    n, h, w = raw.shape
    mjd = np.array([hdr[f"MJD{k}"] for k in range(1, n + 1)])
    t = mjd - mjd.mean()                       # days from the middle of the sequence
    fwhm = float(hdr.get("PSFFWHM", 1.6))
    out_wcs = WCS(hdr).celestial

    F = np.array([matched_filter(f, fwhm) for f in raw]) if a.matched_filter else raw
    R = np.array(residuals(list(F)))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        static = np.nanmedian(F, axis=0)
    # imperfect subtraction around bright stars is the main source of fake candidates: mask it
    bad = binary_dilation(np.nan_to_num(static) > a.mask_above, iterations=2)
    R[:, bad] = np.nan
    print(f"{n} frames over {(mjd.max() - mjd.min()) * 24:.0f} h; PSF {fwhm:.2f} px; "
          f"{100 * bad.mean():.1f}% masked around bright stars")

    Rc = np.clip(R, -a.clip, a.clip)           # NaN stays NaN
    best, best_v, ntried = search(Rc, t, a.vmax, a.min_move)
    noise_best, _, _ = search(-Rc, t, a.vmax, a.min_move)
    bar = float(np.nanmax(noise_best[np.isfinite(noise_best)]))
    print(f"Tried {ntried} distinct motions up to {a.vmax} px/day.")
    print(f"Highest peak in the noise-only (sign-flipped) search: {bar:.1f} sigma "
          f"-> believable candidates must beat this.")
    cands = peaks(best, best_v, a.threshold)

    track = None
    if a.track:
        try:
            tx, ty, tname = track_positions(a.track, list(mjd), out_wcs)
            # straight-line fit: JPL position at the reference time and motion in px/day
            jx, jvx = np.polyval(np.polyfit(t, tx, 1), 0), np.polyfit(t, tx, 1)[0]
            jy, jvy = np.polyval(np.polyfit(t, ty, 1), 0), np.polyfit(t, ty, 1)[0]
            track = (tx, ty, tname, jx, jy, jvx, jvy)
            along = shifted(R, t, jvx, jvy)
            ix, iy = int(round(jx)), int(round(jy))
            per = [np.nanmax(along[k, iy - 1:iy + 2, ix - 1:ix + 2]) for k in range(n)]
            stacked = np.nansum(along[:, iy - 1:iy + 2, ix - 1:ix + 2], axis=0).max() / np.sqrt(n)
            print(f"{tname}: JPL motion ({jvx:+.2f}, {jvy:+.2f}) px/day. Along JPL's track: "
                  f"S/N per frame {[round(float(p), 1) for p in per]} -> stacked {stacked:.1f}")
        except Exception as e:
            print(f"Could not get JPL positions for {a.track}: {e}")

    rows = []
    for i, (x, y, s, vx, vy) in enumerate(cands, 1):
        along = shifted(R, t, vx, vy)
        per = [float(np.nan_to_num(along[k, y, x])) for k in range(n)]
        note = ""
        if track is not None:
            d = np.hypot(x - track[3], y - track[4])
            note = f"  <- {track[2]} ({d:.1f} px from JPL)" if d < 3 else ""
        real = "above noise bar" if s > bar else "below noise bar"
        print(f"  #{i}: pixel ({x}, {y}) motion ({vx:+.2f}, {vy:+.2f}) px/day  stacked S/N {s:.1f} "
              f"({real}); per frame {[round(p, 1) for p in per]}{note}")
        rows.append({"rank": i, "x": x, "y": y, "vx_px_per_day": round(vx, 3), "vy_px_per_day": round(vy, 3),
                     "stacked_snr": round(s, 2), "above_noise_bar": s > bar,
                     "snr_per_frame": " ".join(f"{p:.1f}" for p in per)})
    with open(os.path.join(a.folder, "candidates.csv"), "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=["rank", "x", "y", "vx_px_per_day", "vy_px_per_day",
                                           "stacked_snr", "above_noise_bar", "snr_per_frame"])
        wr.writeheader()
        wr.writerows(rows)
    if not cands:
        print(f"No candidates above {a.threshold} sigma.")
    save_figure(a.folder, F, R, t, best, noise_best, bar, cands, track, mjd)


def save_figure(folder, F, R, t, best, noise_best, bar, cands, track, mjd):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle
    n, h, w = F.shape
    colors = time_colors(n)
    fig = plt.figure(figsize=(17, 9.6), facecolor="#111")
    top = [fig.add_axes([0.02 + i * 0.245, 0.43, 0.225, 0.47]) for i in range(4)]
    vmax = max(np.nanpercentile(best[np.isfinite(best)], 99.9), bar + 2)
    for ax, img, title in [(top[0], best, "best S/N over all motions"),
                           (top[1], noise_best, f"noise-only search (signs flipped)\nhighest {bar:.1f}σ = the bar")]:
        ax.imshow(np.where(np.isfinite(img), img, 0), cmap="magma", origin="lower", vmin=0, vmax=vmax,
                  interpolation="nearest")
        ax.set_title(title, color="white", fontsize=10.5)
    for i, (x, y, s, vx, vy) in enumerate(cands[:5], 1):
        top[0].add_patch(Circle((x, y), 3, fill=False, color="#56B4E9" if s > bar else "#888", lw=1.3))
        top[0].text(x + 3.5, y + 3.5, f"#{i}", color="white", fontsize=9)
    if track is not None:
        top[0].plot(track[0], track[1], color="#E69F00", lw=1, ls="--")
        top[0].text(0.02, 0.02, f"dashed: JPL path of {track[2]}", transform=top[0].transAxes,
                    color="#E69F00", fontsize=8.5)
    if cands:
        x0, y0, s0, vx0, vy0 = cands[0]
        S = shifted(F, t, vx0, vy0)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            mean = np.nanmean(S, axis=0) * np.sqrt(n)
        top[2].imshow(np.clip((np.nan_to_num(mean) + 1) / 25, 0, 1) ** 0.6, cmap="gray", origin="lower",
                      interpolation="nearest")
        top[2].add_patch(Circle((x0, y0), 3.5, fill=False, color="#56B4E9", lw=1.3))
        top[2].set_title(f"stacked along #1's motion\n(mover = sharp dot, stars = streaks)", color="white", fontsize=10.5)
        lo, hi = 1.0, max(np.nanpercentile(F[np.isfinite(F)], 99.8), 11)
        grays = [np.nan_to_num(np.arcsinh(np.clip((f - lo) / (hi - lo), 0, 1) * (hi - lo) / 2)
                               / np.arcsinh((hi - lo) / 2)) for f in S]
        top[3].imshow(onion_dark(grays, colors), origin="lower", interpolation="nearest")
        top[3].add_patch(Circle((x0, y0), 3.5, fill=False, color="white", lw=1.0, ls="--"))
        top[3].set_title("co-moving onion: follow #1's motion\n(mover = white, stars = colour trails)",
                         color="white", fontsize=10.5)
        # stamps of #1 in each difference image, and stacked
        r = 7
        along = shifted(R, t, vx0, vy0)
        ys, xs = slice(max(y0 - r, 0), y0 + r + 1), slice(max(x0 - r, 0), x0 + r + 1)
        cy, cx = y0 - ys.start, x0 - xs.start             # candidate's spot inside the stamp
        for k in range(n + 1):
            ax = fig.add_axes([0.03 + k * (0.94 / (n + 1)), 0.03, 0.94 / (n + 1) - 0.015, 0.31])
            if k < n:
                stamp = along[k, ys, xs]
                title, col = f"frame {k + 1}: {np.nan_to_num(stamp[cy, cx]):.1f}σ", colors[k]
            else:
                stamp = np.nansum(along[:, ys, xs], axis=0) / np.sqrt(n)
                title, col = f"all {n} stacked: {s0:.1f}σ", "white"
            ax.imshow(np.nan_to_num(stamp), cmap="gray", origin="lower", vmin=-2, vmax=8, interpolation="nearest")
            ax.set_title(title, color=col, fontsize=10)
            ax.set_xticks([]); ax.set_yticks([])
    for ax in top:
        ax.set_xticks([]); ax.set_yticks([])
    span_h = (mjd.max() - mjd.min()) * 24
    fig.suptitle(f"Shift-and-stack (digital tracking): {n} frames over {span_h:.0f} h", color="white", fontsize=13)
    fig.savefig(os.path.join(folder, "stack_search.png"), dpi=80, facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    main()
