"""Checks on the tool-test star spots (pipeline/star_targets.py). They read the committed export."""
import json
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
import star_targets as st  # noqa: E402

FIELDS = os.path.join(ROOT, "web", "public", "fields")
ANSWERS = os.path.join(ROOT, "web", "data", "answers")
BY_SLUG = {s["slug"]: s for s in st.STAR_SPOTS}


def _answer(slug):
    path = os.path.join(ANSWERS, f"{slug}.json")
    if not os.path.exists(path):
        pytest.skip(f"{slug} not exported")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def test_proper_motion_over_one_year_matches_simbad():
    """Barnard's Star moves 10.39 arcsec/yr: one year apart the apparent positions differ by
    that much (parallax adds at most 2 x 0.55 arcsec, so allow 1.2 arcsec)."""
    star = BY_SLUG["barnard"]["star"]
    a = st.apparent_radec(60900.0, star)
    b = st.apparent_radec(60900.0 + 365.25, star)
    d = np.hypot((b[0] - a[0]) * np.cos(np.radians(a[1])), b[1] - a[1]) * 3600
    assert abs(d - 10.39) < 1.2


def test_parallax_term_alone_has_the_size_of_the_parallax():
    """A star with no proper motion swings by about its parallax over half a year."""
    star = dict(BY_SLUG["wise0855"]["star"], pmra=0.0, pmdec=0.0)
    a = st.apparent_radec(60800.0, star)
    b = st.apparent_radec(60800.0 + 182.6, star)
    d = np.hypot((b[0] - a[0]) * np.cos(np.radians(a[1])), b[1] - a[1]) * 3600
    assert 0.2 < d < 2 * 0.439 + 0.01


@pytest.mark.parametrize("slug", sorted(BY_SLUG))
def test_star_spot_files_agree(slug):
    ans = _answer(slug)
    with open(os.path.join(FIELDS, slug, "field.json"), encoding="utf-8") as f:
        field = json.load(f)
    assert field["difficulty"] == "tool" and field["kind"] == "spot"
    assert ans["reveal"]["kind"] == "star" and ans["reveal"]["difficulty"] == "tool"
    assert not ans["nothing_moves"]
    (obj,) = ans["objects"]
    assert obj["kind"] == "star" and obj["role"] == BY_SLUG[slug]["star"]["role"]
    assert [p["frame"] for p in obj["positions"]] == [f["i"] for f in field["frames"]]
    assert len(obj["brightness"]) == len(field["frames"])
    with open(os.path.join(FIELDS, "index.json"), encoding="utf-8") as f:
        assert slug in [e["slug"] for e in json.load(f)]
    data = os.path.getsize(os.path.join(FIELDS, slug, "frames.u16"))
    n, (w, h) = len(field["frames"]), field["size"]
    assert data == 2 * n * w * h


@pytest.mark.parametrize("slug", ["barnard", "eps-indi-b", "r-dra", "rw-aur"])
def test_measured_centroid_is_on_the_ephemeris(slug):
    """Where a star is bright enough to centroid, the ephemeris and the image agree to within
    a pixel (SPHEREx pixels are 6.15 arcsec; a bright saturated star is good to about 0.3 px)."""
    obj = _answer(slug)["objects"][0]
    offs = [p["offset_px"] for p in obj["positions"] if "offset_px" in p]
    assert offs, "no frame could be centroided"
    assert np.median(offs) < 1.0


@pytest.mark.parametrize("slug,lo,hi", [("barnard", 1.0, 2.5), ("eps-indi-b", 0.6, 1.6), ("wise0855", 0.8, 2.0)])
def test_movers_move_by_the_catalog_proper_motion(slug, lo, hi):
    obj = _answer(slug)["objects"][0]
    assert lo < obj["total_motion_px"] < hi


@pytest.mark.parametrize("slug", ["rw-aur", "r-dra", "taurus-ice"])
def test_variables_do_not_move(slug):
    assert _answer(slug)["objects"][0]["total_motion_px"] < 0.05
