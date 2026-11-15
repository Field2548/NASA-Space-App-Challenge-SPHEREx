"""Star targets ("tool tests"): named stars that stand in for the planted object.

Three kinds, all built from real SPHEREx frames:
  static    a star that does not move or vary (Elias 16, seen through the Taurus cloud: the
            point is its spectrum, which shows ice absorption).
  mover     a high proper motion star or brown dwarf. It moves a few pixels over the months
            between survey passes (inside one visit it moves less than 0.1 px).
  variable  a star that does not move; the answer is the star whose brightness changes.

Positions come from SIMBAD (J2000 ICRS position, proper motion, parallax, copied into
STAR_SPOTS below with their source), advanced to each frame's time with proper motion and the
annual parallax of the Earth (barycentric). Imported lazily by export_web.answer_key.
"""
import os
import warnings

import numpy as np

PIXEL_SQ_SR = (6.15 / 206264.806) ** 2      # solid angle of one SPHEREx pixel (sr)
APERTURE_PX, SKY_IN_PX, SKY_OUT_PX = 2.0, 3.5, 6.0
MATCH_DLNLAMBDA = 0.04      # exposures within 4 percent in wavelength count as the same band
SATURATION_FLAGS =("OVERFLOW", "NONLINEAR", "BLOOM", "PERSIST", "HALO", "GHOST")

# SIMBAD (simbad.harvard.edu mirror, 2026-11-15): ICRS J2000 position, pm in mas/yr (pmra includes
# cos dec), parallax in mas. Eps Indi B is the Ba+Bb pair, unresolved at 6.15 arcsec per pixel.
STAR_SPOTS = [
    {"slug": "barnard", "folder": "data/motion_269.4464_4.7686_2025-08-21",
     "title": "Test your tool on Barnard's Star", "fov": 0.2,
     "star": {"id": "barnard", "name": "Barnard's Star (GJ 699)", "role": "mover", "variable": False,
              "ra": 269.4520769586187, "dec": 4.693364966576667, "pmra": -801.551, "pmdec": 10362.394,
              "plx": 546.9759, "source": "SIMBAD NAME Barnard's star"}},
    {"slug": "eps-indi-b", "folder": "data/motion_331.0964_-56.8006_2025-04-27",
     "title": "Test your tool on Epsilon Indi B", "fov": 0.2,
     "star": {"id": "eps-indi-b", "name": "Epsilon Indi B (brown dwarf pair Ba+Bb)", "role": "mover",
              "variable": False, "ra": 331.04414658852124, "dec": -56.782844195116105,
              "pmra": 3981.977, "pmdec": -2466.832, "plx": 270.658, "source": "SIMBAD * eps Ind B"}},
    {"slug": "wise0855", "folder": "data/motion_133.7600_-7.2422_2025-05-06",
     "title": "Test your tool on WISE 0855", "fov": 0.1,
     "star": {"id": "wise0855", "name": "WISE J085510.83-071442.5", "role": "mover", "variable": False,
              "ra": 133.81890825, "dec": -7.247048, "pmra": -8123.7, "pmdec": 673.2, "plx": 439.0,
              "longband_um": 3.4,    # a 250 K brown dwarf: invisible below about 3.4 micron
              "source": "SIMBAD WISEA J085510.74-071442.5"}},
    {"slug": "rw-aur", "folder": "data/motion_76.9566_30.4013_2025-09-02",
     "title": "Test your tool on RW Aurigae", "fov": 0.1,
     "star": {"id": "rw-aur", "name": "RW Aurigae", "role": "variable", "variable": True,
              "ra": 76.95652603458333, "dec": 30.401438173888888, "pmra": 7.23, "pmdec": -20.33,
              "plx": 15.42, "source": "SIMBAD V* RW Aur"}},
    {"slug": "r-dra", "folder": "data/motion_248.1672_66.7550_2025-05-16",
     "title": "Test your tool on R Draconis", "fov": 0.1,
     "star": {"id": "r-dra", "name": "R Draconis", "role": "variable", "variable": True,
              "ra": 248.16761083295, "dec": 66.75497941722, "pmra": -20.643, "pmdec": 6.149,
              "plx": 1.2509, "source": "SIMBAD V* R Dra"}},
    # Elias 16 (Elia 3-16, a K giant behind the Taurus cloud): the ice-absorption test star. It does
    # not move and is not variable; the spot ships the 102-band cube so its spectrum can be read.
    {"slug": "taurus-ice", "folder": "data/motion_69.9119_26.1907_2025-08-27",
     "title": "Taurus dark cloud: ice in starlight", "fov": 0.2,
     "star": {"id": "elias16", "name": "Elias 16 (2MASS J04393886+2611266)", "role": "static",
              "variable": False, "ra": 69.91193949634, "dec": 26.19073514211, "pmra": 20.325,
              "pmdec": -28.804, "plx": 3.5094, "source": "SIMBAD Elia 3-16"}},
]


def apparent_radec(mjd, star):
    """(ra, dec) in degrees of the star at this MJD (UTC): linear proper motion from J2000 plus
    the annual parallax of the Earth (SPHEREx is within 0.01 AU of it). Radial motion ignored
    (below 0.001 px over the survey)."""
    import astropy.units as u
    from astropy.coordinates import get_body_barycentric
    from astropy.time import Time
    t = Time(mjd, format="mjd", scale="utc")
    ra0, de0 = np.radians(star["ra"]), np.radians(star["dec"])
    e_r = np.array([-np.sin(ra0), np.cos(ra0), 0.0])
    e_d = np.array([-np.sin(de0) * np.cos(ra0), -np.sin(de0) * np.sin(ra0), np.cos(de0)])
    n0 = np.array([np.cos(de0) * np.cos(ra0), np.cos(de0) * np.sin(ra0), np.sin(de0)])
    mas = np.pi / 180 / 3600 / 1000
    n = n0 + (t.jyear - 2000.0) * (star["pmra"] * mas * e_r + star["pmdec"] * mas * e_d)
    n /= np.linalg.norm(n)
    ea = get_body_barycentric("earth", t)
    earth = np.array([ea.x.to_value(u.AU), ea.y.to_value(u.AU), ea.z.to_value(u.AU)])
    n = n - earth * (star["plx"] * mas)       # direction = r/d - E/d, with 1/d = parallax
    n /= np.linalg.norm(n)
    return float(np.degrees(np.arctan2(n[1], n[0])) % 360), float(np.degrees(np.arcsin(n[2])))


def centroid(frame, x, y, half=2):
    """Flux-weighted centroid in a (2 half + 1)^2 window of one S/N frame (top-down pixels),
    after subtracting the median of the surrounding ring. Returns (cx, cy, peak) or None when the
    window is off the picture or the peak is below 5 sigma."""
    h, w = frame.shape
    ix, iy = int(round(x)), int(round(y))
    if not (half <= ix < w - half and half <= iy < h - half):
        return None
    ring = frame[max(iy - 2 * half - 1, 0):iy + 2 * half + 2, max(ix - 2 * half - 1, 0):ix + 2 * half + 2].copy()
    inner = np.zeros(ring.shape, bool)
    oy, ox = iy - max(iy - 2 * half - 1, 0), ix - max(ix - 2 * half - 1, 0)
    inner[max(oy - half - 1, 0):oy + half + 2, max(ox - half - 1, 0):ox + half + 2] = True
    bg = float(np.nanmedian(ring[~inner]))
    win = frame[iy - half:iy + half + 1, ix - half:ix + half + 1] - bg
    if not np.isfinite(win).all() or win.max() < 5:
        return None
    wgt = np.clip(win, 0, None)
    yy, xx = np.mgrid[-half:half + 1, -half:half + 1]
    return (float(ix + (wgt * xx).sum() / wgt.sum()), float(iy + (wgt * yy).sum() / wgt.sum()),
            float(win.max()))


def exposure_photometry(path, sky_pos):
    """Aperture photometry of one single-band cutout at the sky position (SkyCoord).
    Returns dict: flux_mjy, err_mjy, wavelength_um, saturation flag counts within 3 px, peak
    MJy/sr, edge (aperture partly off the cutout) or None when the star is off the cutout.
    The cutout is zodi-subtracted (spectral_bands.clean_band); dead pixels are interpolated there,
    so flags are read from the raw FLAGS plane."""
    from astropy.io import fits
    from astropy.wcs import WCS
    from export_web import _repo_imports
    _repo_imports()
    from spectral_bands import clean_band
    img, in_wcs, _ = clean_band(path)
    px, py = (float(v) for v in in_wcs.world_to_pixel(sky_pos))
    ny, nx = img.shape
    if not (0 <= px < nx and 0 <= py < ny):
        return None
    yy, xx = np.mgrid[0:ny, 0:nx]
    r = np.hypot(xx - px, yy - py)
    ap, sky = r <= APERTURE_PX, (r >= SKY_IN_PX) & (r <= SKY_OUT_PX) & np.isfinite(img)
    if sky.sum() < 10:
        return None
    bg = float(np.median(img[sky]))
    noise = float(1.4826 * np.median(np.abs(img[sky] - bg)))
    n_ap = int(ap.sum())
    to_mjy = PIXEL_SQ_SR * 1e9                       # MJy/sr per pixel -> mJy
    with fits.open(path) as hdul:
        flags = hdul["FLAGS"].data.astype(np.int64)
        hdr = hdul["FLAGS"].header
        spectral = WCS(header=hdul["IMAGE"].header, fobj=hdul, key="W")
        spectral.sip = None
        wl, _ = spectral.pixel_to_world(px, py)
    bits = {str(hdr[k]).strip(): 1 << int(k[4:]) for k in hdr["MSKN*"]}
    near = r <= 3.0
    counts = {name: int(((flags & bits[name]) != 0)[near].sum()) for name in SATURATION_FLAGS if name in bits}
    return {"flux_mjy": float((img[ap] - bg).sum() * to_mjy), "err_mjy": float(noise * np.sqrt(n_ap) * to_mjy),
            "wavelength_um": float(wl.to_value("um")), "peak_mjy_sr": float(np.nanmax(img[ap])),
            "flags_within_3px": counts, "edge": bool(r.min() > 0 and (px < 3 or py < 3 or px > nx - 4 or py > ny - 4))}


def band_photometry(folder, frame_positions):
    """Photometry of every exposure behind every frame. frame_positions: sky positions (SkyCoord)
    one per frame. Returns a list (one per frame) of lists of exposure dicts. Then the ratio to
    a smooth spectrum is added (see add_ratio)."""
    from export_web import read_frames_csv
    out = []
    for m, pos in zip(read_frames_csv(folder), frame_positions):
        rows = []
        for name in m["files"]:
            r = exposure_photometry(os.path.join(folder, "images", name), pos)
            if r is not None:
                r["file"] = name
                rows.append(r)
        out.append(rows)
    return out


def add_ratio(per_frame):
    """Brightness change that is not just wavelength. Every burst samples different bands, so
    compare only exposures of the same band (wavelengths within MATCH_DLNLAMBDA, about 4 percent)
    in different frames: for each frame, the median flux ratio to every earlier frame that has
    matching bands (both detected at 3 sigma), with the pair count and scatter."""
    summary = []
    for k, f in enumerate(per_frame, start=1):
        vs = {}
        for j in range(k - 1):
            r = [a["flux_mjy"] / b["flux_mjy"] for a in f for b in per_frame[j]
                 if abs(np.log(a["wavelength_um"] / b["wavelength_um"])) < MATCH_DLNLAMBDA
                 and a["flux_mjy"] > 3 * a["err_mjy"] and b["flux_mjy"] > 3 * b["err_mjy"]]
            if r:
                vs[str(j + 1)] = {"n_pairs": len(r), "flux_ratio": round(float(np.median(r)), 3),
                                  "scatter": round(float(1.4826 * np.median(np.abs(np.array(r) - np.median(r)))), 3)}
        summary.append({"frame": k, "n_exposures": len(f),
                        "n_detected": int(sum(r["flux_mjy"] > 3 * r["err_mjy"] for r in f)),
                        "flux_ratio_vs_earlier_frame": vs,
                        "exposures": [{"file": r["file"], "wavelength_um": round(r["wavelength_um"], 4),
                                       "flux_mjy": round(r["flux_mjy"], 3), "err_mjy": round(r["err_mjy"], 3),
                                       "flags_within_3px": r["flags_within_3px"]} for r in f]})
    return summary


def longband_centroids(folder, wcs, shape, phot, xs, ys, band_min):
    """For a source that only shows at long wavelengths (a brown dwarf: nothing below about
    3.4 micron), average the exposures with wavelength above band_min on the frame grid and
    centroid that. Returns a list (per frame) of (cx, cy, peak S/N, n_bands) or None."""
    from export_web import _repo_imports, fits_sky_grid
    _repo_imports()
    from spectral_bands import clean_band, resample
    h, w = shape
    sky = fits_sky_grid(wcs, (h, w))
    out = []
    for k, rows in enumerate(phot):
        planes = []
        for r in rows:
            if r["wavelength_um"] > band_min:
                img, in_wcs, _ = clean_band(os.path.join(folder, "images", r["file"]))
                planes.append(resample(img, in_wcs, sky)[::-1])
        if not planes:
            out.append(None)
            continue
        st = np.nanmean(planes, axis=0)
        st = (st - np.nanmedian(st)) / (1.4826 * np.nanmedian(np.abs(st - np.nanmedian(st))))
        c = centroid(st, xs[k], ys[k])
        out.append(None if c is None else (*c, len(planes)))
    return out


def star_object(folder, wcs, mjds, frames, star, resid=None):
    """The answer-key object of a star target (field-schema.md section 6, kind "star").
    Per frame: expected position (ephemeris), measured centroid and the offset in pixels,
    S/N, and for the variable role the brightness measured from the single exposures."""
    from astropy.coordinates import SkyCoord
    from export_web import MID_EXPOSURE_DAYS, to_top_down
    height, width = frames.shape[1:]
    sky = [apparent_radec(m + MID_EXPOSURE_DAYS, star) for m in mjds]
    coords = SkyCoord([s[0] for s in sky], [s[1] for s in sky], unit="deg")
    fx, fy = wcs.world_to_pixel(coords)
    x, y = to_top_down(fx, fy, height)
    days = np.asarray(mjds) - float(np.mean(mjds))
    positions = []
    for k in range(len(mjds)):
        inside = bool(-0.5 <= x[k] <= width - 0.5 and -0.5 <= y[k] <= height - 0.5)
        p = {"frame": k + 1, "x": round(float(x[k]), 2), "y": round(float(y[k]), 2), "in_grid": inside}
        if inside:
            ix, iy = int(round(x[k])), int(round(y[k]))
            box = frames[k, max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2]
            p["snr"] = round(float(np.nanmax(box)), 1) if np.isfinite(box).any() else None
            if resid is not None:
                rbox = resid[k, max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2]
                p["change_snr"] = round(float(np.nanmax(rbox)), 1) if np.isfinite(rbox).any() else None
            c = centroid(frames[k], x[k], y[k])
            if c is not None:
                p["measured_x"], p["measured_y"] = round(c[0], 2), round(c[1], 2)
                p["offset_px"] = round(float(np.hypot(c[0] - x[k], c[1] - y[k])), 2)
        positions.append(p)
    obj = {"id": star["id"], "name": star["name"], "kind": "star", "role": star["role"],
           "source": star["source"] + " + proper motion + parallax",
           "positions": positions,
           "vx_px_per_day": round(float(np.polyfit(days, x, 1)[0]), 5),
           "vy_px_per_day": round(float(np.polyfit(days, y, 1)[0]), 5),
           "total_motion_px": round(float(np.hypot(x[-1] - x[0], y[-1] - y[0])), 2)}
    phot = band_photometry(folder, coords)
    obj["brightness"] = add_ratio(phot)
    if star.get("longband_um"):
        lb = longband_centroids(folder, wcs, (height, width), phot, x, y, star["longband_um"])
        for p, c in zip(positions, lb):
            if c is not None:
                p["longband_x"], p["longband_y"] = round(c[0], 2), round(c[1], 2)
                p["longband_snr"], p["longband_n"] = round(c[2], 1), c[3]
                p["longband_offset_px"] = round(float(np.hypot(c[0] - p["x"], c[1] - p["y"])), 2)
    flagged = sum(sum(v > 0 for v in r["flags_within_3px"].values()) > 0 for f in phot for r in f)
    total = sum(len(f) for f in phot)
    obj["saturation"] = {"exposures_checked": total, "exposures_with_overflow_or_nonlinear_flag_within_3px":
                         int(sum(any(r["flags_within_3px"].get(n, 0) > 0 for n in ("OVERFLOW", "NONLINEAR"))
                                 for f in phot for r in f)),
                         "exposures_with_any_listed_flag_within_3px": int(flagged),
                         "max_peak_mjy_sr": round(max((r["peak_mjy_sr"] for f in phot for r in f), default=0), 1)}
    return obj
