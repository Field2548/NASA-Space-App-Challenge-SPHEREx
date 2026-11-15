"""Offline tests for pipeline/catalog_facts.py against the committed web/data/catalog/*.json.
No network: the files are read as they are in the repo. Contract: field-schema.md section 9."""
import json
import math
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
import catalog_facts as cf  # noqa: E402

SLUGS = ["eros", "hektor", "makemake", "eris", "cygnus"]
TRACKED = {"eros": "433", "hektor": "624", "makemake": "136472", "eris": "136199"}
# plausible distance from the Sun (au) of each tracked object
R_RANGE = {"eros": (1.0, 2.0), "hektor": (4.5, 6.0), "makemake": (50, 54), "eris": (94, 98)}
STAR_KEYS = {"source", "id", "name", "otype", "sp_type", "ra", "dec", "pmra", "pmdec", "plx",
             "plx_over_err", "g_mag", "bp_rp", "rv", "z", "xy"}


def _load(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return json.load(f)


def _walk_numbers(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from _walk_numbers(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk_numbers(v)
    elif isinstance(o, float):
        yield o


@pytest.fixture(scope="module", params=SLUGS)
def spot(request):
    slug = request.param
    return slug, _load(f"web/data/catalog/{slug}.json"), \
        _load(f"web/public/fields/{slug}/field.json"), _load(f"web/data/answers/{slug}.json")


def test_shape_matches_contract(spot):
    slug, cat, field, _ = spot
    n = len(field["frames"])
    assert cat["slug"] == slug
    assert [f["i"] for f in cat["frames"]] == list(range(1, n + 1))
    for f, ff in zip(cat["frames"], field["frames"]):
        assert f["mjd"] == pytest.approx(ff["mjd"], abs=1e-5)
    assert set(cat["sources"]) == {"simbad", "gaia", "jpl"}
    for key in ("stars", "objects", "asteroids"):
        assert isinstance(cat[key], list)
    for s in cat["stars"]:
        assert set(s) == STAR_KEYS
        assert s["source"] in ("gaia", "simbad")
        assert len(s["xy"]) == n
        assert all(len(p) == 2 for p in s["xy"])
    for o in cat["objects"]:
        assert len(o["r_au"]) == n and len(o["delta_au"]) == n
    for a in cat["asteroids"]:
        assert a["name"] and a["positions"]
        for p in a["positions"]:
            assert {"frame", "x", "y", "ra", "dec", "vmag"} <= set(p)
            assert 1 <= p["frame"] <= n


def test_source_counts_and_limit(spot):
    _, cat, _, _ = spot
    for name in ("simbad", "gaia"):
        assert cat["sources"][name]["count"] == sum(s["source"] == name for s in cat["stars"])
    g = cat["sources"]["gaia"]
    assert g["epoch"] == 2016.0
    assert g["count"] <= cf.GAIA_MAX
    assert g["g_mag_limit"] <= cf.GAIA_G_LIMIT
    assert g["truncated"] == (g["g_mag_limit"] < cf.GAIA_G_LIMIT)
    assert all(s["g_mag"] <= g["g_mag_limit"] for s in cat["stars"] if s["source"] == "gaia")


def test_no_nan_or_inf(spot):
    _, cat, _, _ = spot
    assert all(math.isfinite(v) for v in _walk_numbers(cat))


def test_stars_are_near_the_picture(spot):
    _, cat, field, _ = spot
    w, h = field["size"]
    for s in cat["stars"]:
        inside = [(-2 < x < w + 1) and (-2 < y < h + 1) for x, y in s["xy"]]
        assert any(inside)


def test_tracked_object_matches_answer_key(spot):
    slug, cat, _, ans = spot
    if slug not in TRACKED:
        assert cat["objects"] == [] and ans["objects"] == []
        return
    key = ans["objects"][0]
    assert cat["objects"][0]["id"] == key["id"] == TRACKED[slug]
    rows = [a for a in cat["asteroids"] if a["name"].split()[0] == key["id"]]
    assert len(rows) == 1
    by_frame = {p["frame"]: p for p in rows[0]["positions"]}
    checked = 0
    for p in key["positions"]:
        if not p["in_grid"]:
            continue
        assert p["frame"] in by_frame, f"frame {p['frame']} missing from SB-ident"
        d = math.hypot(by_frame[p["frame"]]["x"] - p["x"], by_frame[p["frame"]]["y"] - p["y"])
        assert d <= 2.0, f"{slug} frame {p['frame']}: {d:.2f} px from the answer key"
        checked += 1
    assert checked >= 1


def test_distances_in_range(spot):
    slug, cat, _, _ = spot
    if slug not in TRACKED:
        return
    o = cat["objects"][0]
    lo, hi = R_RANGE[slug]
    assert all(lo < r < hi for r in o["r_au"])
    # the Earth is never farther than about 1 au beyond r, and never closer than r - 1.02 au
    assert all(abs(r - d) < 1.02 for r, d in zip(o["r_au"], o["delta_au"]))
    assert all(d > 0 for d in o["delta_au"])


def test_moved_against_astropy():
    import astropy.units as u
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    mjds = [60865.75, 61500.0, 57388.0]
    years = Time(mjds, format="mjd").jyear
    cases = [(269.4520769, 4.6933649, -802.803, 10362.542, 546.976),    # Barnard's star
             (100.0, 80.0, -500.0, 300.0, 1.0),                         # high declination
             (10.0, -60.0, 120.0, -40.0, 5.0)]
    for ra, dec, pmra, pmdec, plx in cases:
        r, d = cf.moved(ra, dec, pmra, pmdec, 2016.0, years)
        sc = SkyCoord(ra * u.deg, dec * u.deg, pm_ra_cosdec=pmra * u.mas / u.yr,
                      pm_dec=pmdec * u.mas / u.yr, distance=(1000 / plx) * u.pc,
                      obstime=Time(2016.0, format="jyear"))
        for k, m in enumerate(mjds):
            ref = sc.apply_space_motion(new_obstime=Time(m, format="mjd"))
            dra = (r[k] - ref.ra.deg) * math.cos(math.radians(dec)) * 3600
            ddec = (d[k] - ref.dec.deg) * 3600
            assert abs(dra) < 0.01 and abs(ddec) < 0.01     # arcsec; a pixel is 6.15
    # sign: a star with positive pmra moves to larger RA after the epoch, smaller before it
    r, _ = cf.moved(50.0, 0.0, 100.0, 0.0, 2016.0, [2026.0, 2006.0])
    assert r[0] > 50.0 > r[1]
    # cos(dec): 1000 mas/yr on the sky at dec 60 is twice as much in RA degrees as at dec 0
    r60, _ = cf.moved(50.0, 60.0, 1000.0, 0.0, 2016.0, [2017.0])
    r0, _ = cf.moved(50.0, 0.0, 1000.0, 0.0, 2016.0, [2017.0])
    assert (r60[0] - 50.0) == pytest.approx(2 * (r0[0] - 50.0), rel=1e-3)
    # no proper motion: the catalog position
    r, d = cf.moved(50.0, 10.0, None, None, 2016.0, [2020.0])
    assert r[0] == 50.0 and d[0] == 10.0


def test_sexa_helpers():
    assert cf._sexa(-0.5).startswith("M")
    assert cf._sexa(0.5) == "00-30-00.00"
    assert cf._sexa(13.2004, hours=True) == "00-52-48.10"
    assert cf._sexa(0.99999999) == "01-00-00.00"            # seconds never print as 60.00
    assert cf._parse_sexa("-00 30'00.0\"") < 0
    assert cf._parse_sexa("-00 30'00.0\"") == pytest.approx(-0.5)
    assert cf._parse_sexa("+14 20'46.8\"") == pytest.approx(14 + 20 / 60 + 46.8 / 3600)
    assert cf._parse_sexa("00:52:37.70", hours=True) == pytest.approx(
        (52 / 60 + 37.7 / 3600) * 15)
    # round trip, including between -1 and 0 degrees
    for deg in (-0.5, -0.0083, 0.25, -42.4437, 14.38):
        text = cf._sexa(deg)
        sign = "-" if text.startswith("M") else "+"
        a, b, c = text.lstrip("M").split("-")
        assert cf._parse_sexa(f"{sign}{a} {b}'{c}\"") == pytest.approx(deg, abs=1e-5)
