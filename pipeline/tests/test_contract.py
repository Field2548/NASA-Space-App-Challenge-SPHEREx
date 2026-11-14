"""Checks that the contract's pixel formula (docs/contracts/field-schema.md, section 1) agrees
with astropy's TAN projection on the exported spots. The formula is re-implemented here on
purpose, so nothing in this file imports it from the code under test."""
import json
import math
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, ROOT)
import export_web as ew  # noqa: E402

FIELDS = os.path.join(ROOT, "web", "public", "fields")
SLUGS = [s["slug"] for s in ew.SPOTS]


def sky_to_pixel(wcs, size, ra, dec):
    # gnomonic (TAN) projection about crval, in degrees; then the contract's two lines
    ra0, dec0 = (math.radians(v) for v in wcs["crval"])
    a, d = math.radians(ra), math.radians(dec)
    cosc = math.sin(dec0) * math.sin(d) + math.cos(dec0) * math.cos(d) * math.cos(a - ra0)
    xi = math.degrees(math.cos(d) * math.sin(a - ra0) / cosc)
    eta = math.degrees((math.cos(dec0) * math.sin(d) - math.sin(dec0) * math.cos(d) * math.cos(a - ra0)) / cosc)
    w, h = size
    x = (wcs["crpix"][0] - 1) + xi / wcs["cdelt"][0]
    y = (h - wcs["crpix"][1]) - eta / wcs["cdelt"][1]
    return x, y


def _field(slug):
    with open(os.path.join(FIELDS, slug, "field.json"), encoding="utf-8") as f:
        return json.load(f)


def _grid_points(w, h):
    xs = list(range(0, w, 10))
    ys = list(range(0, h, 10))
    pts = [(x, y) for y in ys for x in xs]
    pts += [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), ((w - 1) / 2, (h - 1) / 2)]
    return pts


@pytest.mark.parametrize("slug", SLUGS)
def test_formula_matches_astropy_on_the_grid(slug):
    from astropy.coordinates import SkyCoord
    from spectral_bands import grid_wcs
    field = _field(slug)
    wcs_astropy, shape = grid_wcs(SkyCoord(field["ra"], field["dec"], unit="deg"), field["fov_deg"])
    w, h = field["size"]
    assert tuple(shape) == (h, w)
    worst = 0.0
    for x, y_top in _grid_points(w, h):
        y_fits = h - 1 - y_top
        sky = wcs_astropy.pixel_to_world(x, y_fits)
        px, py = sky_to_pixel(field["wcs"], field["size"], sky.ra.deg, sky.dec.deg)
        err = max(abs(px - x), abs(py - y_top))
        worst = max(worst, err)
        assert err <= 0.005, (slug, x, y_top, px, py)
    print(f"{slug}: max error {worst:.3e} px")


def test_fixture_crval_is_the_centre_pixel():
    field = _field("fixture")
    x, y = sky_to_pixel(field["wcs"], field["size"], *field["wcs"]["crval"])
    assert abs(x - 15.0) < 1e-9 and abs(y - 16.0) < 1e-9
