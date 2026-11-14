"""Pre-made catalog facts for the ready spots: web/data/catalog/<slug>.json (server only).

    python pipeline/catalog_facts.py --all          # the five ready spots
    python pipeline/catalog_facts.py --slug eros    # one of them

With this file the Inspect popup and the overlays need no live network call for ready spots
(BUILD_PROMPT 6.5). Format: docs/contracts/field-schema.md section 9.

What goes in, and from where (nothing is estimated or invented here):
  stars      SIMBAD (table basic) and Gaia DR3 (gaiadr3.gaia_source) cones that cover the spot,
             each star's position moved to every frame's date with its catalog proper motion
  objects    the answer-key object's distance from the Sun (r) and from the Earth's centre
             (delta) at each frame time, from JPL Horizons
  asteroids  every known asteroid or comet in the spot at each frame time, from the JPL
             Small-Body Identification API (second pass: numerically integrated orbits)
"""
import json
import os
import re
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_web import ROOT, SPOTS, _repo_imports, write_json  # noqa: E402

SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
SB_IDENT = "https://ssd-api.jpl.nasa.gov/sb_ident.api"
GAIA_EPOCH, SIMBAD_EPOCH = 2016.0, 2000.0      # reference epochs of the catalog positions
GAIA_G_LIMIT, GAIA_MAX = 19.0, 2000            # keep the file small in crowded fields
GAIA_FETCH_MAX = 50000                         # safety stop for the raw cone download
SIMBAD_TRIES = 2                               # SIMBAD is polite-use and may be down: fail soon
MAS_PER_DEG = 3.6e6


def _get(url, params, tries=4, timeout=180, post=False):
    """HTTP with retries and backoff. Returns the decoded JSON."""
    import requests
    for attempt in range(tries):
        try:
            r = (requests.post(url, data=params, timeout=timeout) if post
                 else requests.get(url, params=params, timeout=timeout))
            r.raise_for_status()
            return r.json()
        except Exception as e:                      # noqa: BLE001 (network: retry anything)
            if attempt == tries - 1:
                raise
            print(f"  {url.split('/')[2]} failed ({str(e)[:80]}), retry in {10 * (attempt + 1)} s")
            time.sleep(10 * (attempt + 1))


def tap_query(url, adql, tries=4):
    """Run one ADQL query on a TAP service; returns a list of dicts (None for missing)."""
    out = _get(url, {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql},
               tries=tries, post=True)
    names = [c["name"] for c in out["metadata"]]
    return [dict(zip(names, row)) for row in out["data"]]


def cone_radius(fov):
    """Radius of a circle that covers the whole square spot, plus 10 arcsec."""
    return fov / 2 * np.sqrt(2) + 10 / 3600


def simbad_cone(ra, dec, radius):
    return tap_query(SIMBAD_TAP, tries=SIMBAD_TRIES, adql=f"""
        SELECT main_id, otype, sp_type, ra, dec, pmra, pmdec, plx_value, plx_err, rvz_redshift,
               rvz_radvel
        FROM basic
        WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1""")


def gaia_cone(ra, dec, radius):
    return tap_query(GAIA_TAP, f"""
        SELECT TOP {GAIA_FETCH_MAX} source_id, ra, dec, parallax, parallax_error,
               parallax_over_error, pmra, pmdec, phot_g_mean_mag, bp_rp, radial_velocity
        FROM gaiadr3.gaia_source
        WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
          AND phot_g_mean_mag <= {GAIA_G_LIMIT}
        ORDER BY phot_g_mean_mag ASC""")


def moved(ra, dec, pmra, pmdec, epoch, years):
    """Catalog position moved to each date with its proper motion (mas/yr; pmra already
    includes cos(dec), as in both catalogs). Straight-line motion on the sky: good to far
    better than a pixel over these 25 years. No proper motion = the catalog position."""
    dt = np.asarray(years) - epoch
    if pmra is None or pmdec is None:
        return np.full(dt.shape, ra), np.full(dt.shape, dec)
    return (ra + pmra * dt / MAS_PER_DEG / np.cos(np.radians(dec)),
            dec + pmdec * dt / MAS_PER_DEG)


def _num(v, digits):
    return None if v is None or not np.isfinite(v) else round(float(v), digits)


def star_rows(simbad, gaia, wcs, shape, years):
    """Merge both cones into the contract's 'stars' list; keep stars inside the picture
    (2 px margin) in at least one frame. xy is 0-based top-down, one pair per frame."""
    from astropy.coordinates import SkyCoord
    h, w = shape
    rows = []

    def add(source, ra, dec, pmra, pmdec, epoch, extra):
        ras, decs = moved(ra, dec, pmra, pmdec, epoch, years)
        fx, fy = wcs.world_to_pixel(SkyCoord(ras, decs, unit="deg"))
        x, y = np.asarray(fx, dtype=float), h - 1 - np.asarray(fy, dtype=float)
        if not ((x > -2) & (x < w + 1) & (y > -2) & (y < h + 1)).any():
            return
        rows.append({"source": source, **extra, "ra": round(ra, 7), "dec": round(dec, 7),
                     "pmra": _num(pmra, 3), "pmdec": _num(pmdec, 3),
                     "xy": [[round(float(a), 2), round(float(b), 2)] for a, b in zip(x, y)]})

    for s in simbad:
        if s["ra"] is None or s["dec"] is None:
            continue
        plx, err = s["plx_value"], s["plx_err"]
        add("simbad", s["ra"], s["dec"], s["pmra"], s["pmdec"], SIMBAD_EPOCH, {
            "id": s["main_id"], "name": s["main_id"], "otype": s["otype"],
            "sp_type": s["sp_type"] or None, "plx": _num(plx, 4),
            "plx_over_err": _num(plx / err, 2) if plx is not None and err else None,
            "g_mag": None, "bp_rp": None, "rv": _num(s["rvz_radvel"], 2),
            "z": _num(s["rvz_redshift"], 6)})
    for g in gaia:
        add("gaia", g["ra"], g["dec"], g["pmra"], g["pmdec"], GAIA_EPOCH, {
            "id": f"Gaia DR3 {g['source_id']}", "name": None, "otype": None, "sp_type": None,
            "plx": _num(g["parallax"], 4), "plx_over_err": _num(g["parallax_over_error"], 2),
            "g_mag": _num(g["phot_g_mean_mag"], 3), "bp_rp": _num(g["bp_rp"], 3),
            "rv": _num(g["radial_velocity"], 2), "z": None})
    return rows


def horizons_distances(track, mjds):
    """r and delta (au) of a small body at each time, from JPL Horizons at the geocentre."""
    from astropy.time import Time
    from astroquery.jplhorizons import Horizons
    eph = Horizons(id=track, id_type="smallbody", location="500",
                   epochs=[Time(m, format="mjd").jd for m in mjds]).ephemerides(quantities="19,20")
    return {"id": str(track), "name": str(eph["targetname"][0]), "source": "JPL Horizons",
            "r_au": [round(float(v), 6) for v in eph["r"]],
            "delta_au": [round(float(v), 6) for v in eph["delta"]]}


def _sexa(deg, hours=False):
    """Degrees -> the API's 'hh-mm-ss.ss' / 'dd-mm-ss.ss' with M for minus. Rounds in whole
    hundredths of a second first, so seconds can never print as 60.00."""
    hund = round(abs(deg) / (15 if hours else 1) * 360000)
    a, rest = divmod(hund, 360000)
    b, c = divmod(rest, 6000)
    return f"{'M' if deg < 0 else ''}{a:02d}-{b:02d}-{c / 100:05.2f}"


def _parse_sexa(text, hours=False):
    """'00:52:37.70' or '+14 20\\'46.8"' -> degrees."""
    a, b, c = (float(v) for v in re.findall(r"[\d.]+", text)[:3])
    v = (a + b / 60 + c / 3600) * (15 if hours else 1)
    return -v if text.strip().startswith("-") else v


def sb_ident(ra, dec, half_width, mjd):
    """Known small bodies in a square field at one time (JPL Small-Body Identification API).
    Observer: the Earth's centre, given as a zero geocentric state vector, because the API
    does not accept MPC code 500. SPHEREx is about 650 km up; for anything beyond 0.1 au that
    shifts the position by less than a tenth of a pixel. Returns [{name, ra, dec, vmag}]."""
    from astropy.time import Time
    out = _get(SB_IDENT, {
        "xobs": "0,0,0,0,0,0", "obs-time": Time(mjd, format="mjd").strftime("%Y-%m-%d_%H:%M:%S"),
        "fov-ra-center": _sexa(ra, hours=True), "fov-dec-center": _sexa(dec),
        "fov-ra-hwidth": round(half_width, 4), "fov-dec-hwidth": round(half_width, 4),
        "two-pass": "true", "mag-required": "false"})
    if "data_second_pass" not in out:
        return []
    col = {name: i for i, name in enumerate(out["fields_second"])}
    name_i = col["Object name"]
    ra_i = next(i for n, i in col.items() if n.startswith("Astrometric RA"))
    dec_i = next(i for n, i in col.items() if n.startswith("Astrometric Dec"))
    mag_i = next(i for n, i in col.items() if n.startswith("Visual magnitude"))
    found = []
    for row in out["data_second_pass"]:
        try:
            vmag = float(row[mag_i])
        except (TypeError, ValueError):
            vmag = None
        found.append({"name": row[name_i].strip(), "ra": _parse_sexa(row[ra_i], hours=True),
                      "dec": _parse_sexa(row[dec_i]), "vmag": vmag})
    return found


def asteroid_rows(ra, dec, fov, mjds, wcs, shape):
    """The contract's 'asteroids' list: one entry per object, with a position for every frame
    in which it lies inside the picture (2 px margin). The API box is padded by 0.02 deg so
    nothing near the edge is missed; objects that never fall inside the picture are dropped."""
    from astropy.coordinates import SkyCoord
    h, w = shape
    by_name = {}
    for k, mjd in enumerate(mjds, start=1):
        for obj in sb_ident(ra, dec, fov / 2 + 0.02, mjd):
            fx, fy = wcs.world_to_pixel(SkyCoord(obj["ra"], obj["dec"], unit="deg"))
            x, y = float(fx), float(h - 1 - fy)
            if not (-2 < x < w + 1 and -2 < y < h + 1):
                continue
            by_name.setdefault(obj["name"], []).append({
                "frame": k, "x": round(x, 2), "y": round(y, 2),
                "ra": round(obj["ra"], 6), "dec": round(obj["dec"], 6), "vmag": obj["vmag"]})
        time.sleep(1)                               # be polite to the JPL service
    return [{"name": name, "positions": pos} for name, pos in sorted(by_name.items())]


def gaia_limited(gaia, wcs, shape, years):
    """Gaia stars in the picture, cut at the faintest magnitude that keeps the count within
    GAIA_MAX. Starts at GAIA_G_LIMIT and steps down by 0.25 mag, so a crowded field (Cygnus)
    gets a brighter limit instead of a silent cut. Returns (rows, limit_used)."""
    limit = GAIA_G_LIMIT
    while True:
        keep = [g for g in gaia if g["phot_g_mean_mag"] is not None
                and g["phot_g_mean_mag"] <= limit]
        rows = star_rows([], keep, wcs, shape, years)
        if len(rows) <= GAIA_MAX or limit <= 8:
            return rows, limit
        limit -= 0.25


def catalog_facts(ra, dec, fov, mjds, track=None):
    """Everything for one spot. mjds: the frame times. track: JPL small-body id or None."""
    _repo_imports()
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    from spectral_bands import grid_wcs
    wcs, shape = grid_wcs(SkyCoord(ra, dec, unit="deg"), fov)
    years = Time(list(mjds), format="mjd").jyear
    radius = cone_radius(fov)
    try:
        simbad_rows = simbad_cone(ra, dec, radius)
        simbad_status = "ok"
    except Exception as e:                          # noqa: BLE001 (service down: say so, no stars)
        print(f"  SIMBAD unavailable: {str(e)[:100]}")
        simbad_rows, simbad_status = [], "unavailable"
    gaia = gaia_cone(ra, dec, radius)
    if len(gaia) >= GAIA_FETCH_MAX:
        raise RuntimeError("Gaia cone hit the download cap; lower GAIA_G_LIMIT")
    simbad_stars = star_rows(simbad_rows, [], wcs, shape, years)
    gaia_stars, g_limit = gaia_limited(gaia, wcs, shape, years)
    facts = {
        "frames": [{"i": k, "mjd": round(float(m), 6)} for k, m in enumerate(mjds, start=1)],
        "sources": {
            "simbad": {"service": "SIMBAD TAP (CDS)", "table": "basic", "epoch": SIMBAD_EPOCH,
                       "status": simbad_status, "count": len(simbad_stars)},
            "gaia": {"service": "ESA Gaia archive TAP", "table": "gaiadr3.gaia_source",
                     "epoch": GAIA_EPOCH, "g_mag_limit": g_limit,
                     "truncated": g_limit < GAIA_G_LIMIT, "count": len(gaia_stars)},
            "jpl": {"service": "JPL Horizons and JPL Small-Body Identification API",
                    "observer": "geocentre"}},
        "stars": simbad_stars + gaia_stars,
        "objects": [horizons_distances(track, mjds)] if track else [],
        "asteroids": asteroid_rows(ra, dec, fov, mjds, wcs, shape),
    }
    return facts


def main():
    import argparse
    p = argparse.ArgumentParser(description="Write web/data/catalog/<slug>.json for ready spots.")
    p.add_argument("--all", action="store_true")
    p.add_argument("--slug", action="append", default=[])
    a = p.parse_args()
    todo = [s for s in SPOTS if a.all or s["slug"] in a.slug]
    if not todo:
        raise SystemExit("give --all or --slug NAME")
    for s in todo:
        with open(os.path.join(ROOT, "web", "public", "fields", s["slug"], "field.json"),
                  encoding="utf-8") as f:
            field = json.load(f)
        facts = catalog_facts(field["ra"], field["dec"], field["fov_deg"],
                              [fr["mjd"] for fr in field["frames"]], track=s["track"])
        write_json(os.path.join(ROOT, "web", "data", "catalog", f"{s['slug']}.json"),
                   {"slug": s["slug"], **facts})
        src = facts["sources"]
        print(f"{s['slug']}: {src['simbad']['count']} SIMBAD, {src['gaia']['count']} Gaia"
              f"{' (truncated)' if src['gaia']['truncated'] else ''}, "
              f"{len(facts['asteroids'])} known small bodies, {len(facts['objects'])} tracked")


if __name__ == "__main__":
    main()
