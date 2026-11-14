"""Checks on the exported ready spots (contract: docs/contracts/field-schema.md).
They read the committed export, so they need no network. Tests that compare against
frames.fits are skipped when that (gitignored) file is absent."""
import json
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
import export_web as ew  # noqa: E402

FIELDS = os.path.join(ROOT, "web", "public", "fields")
ANSWERS = os.path.join(ROOT, "web", "data", "answers")
SLUGS = [s["slug"] for s in ew.SPOTS]
SPOT = {s["slug"]: s for s in ew.SPOTS}


def load(slug):
    with open(os.path.join(FIELDS, slug, "field.json"), encoding="utf-8") as f:
        field = json.load(f)
    w, h = field["size"]
    d = field["data"]
    path = os.path.join(FIELDS, slug, d["file"])
    frames = ew.read_u16(path, (len(field["frames"]), h, w), d["scale"], d["offset"])
    with open(os.path.join(ANSWERS, f"{slug}.json"), encoding="utf-8") as f:
        return field, frames, json.load(f)


def has_fits(slug):
    return os.path.exists(os.path.join(ROOT, SPOT[slug]["folder"], "frames.fits"))


@pytest.mark.parametrize("slug", SLUGS)
def test_files_match_field_json(slug):
    field, frames, ans = load(slug)
    w, h = field["size"]
    n = len(field["frames"])
    assert os.path.getsize(os.path.join(FIELDS, slug, "frames.u16")) == 2 * n * h * w
    assert [f["i"] for f in field["frames"]] == list(range(1, n + 1))
    assert all(a["mjd"] < b["mjd"] for a, b in zip(field["frames"], field["frames"][1:]))
    assert field["wcs"]["crpix"] == [(w + 1) / 2, (h + 1) / 2]      # centred, 1-based
    assert len(field["thumbs"]) == n
    for t in field["thumbs"]:
        assert os.path.exists(os.path.join(FIELDS, slug, t))
    assert np.isfinite(frames).mean() > 0.8
    assert ans["slug"] == slug
    with open(os.path.join(FIELDS, "index.json"), encoding="utf-8") as f:
        assert slug in [e["slug"] for e in json.load(f)]


def test_answer_keys_are_not_public():
    for root, _, files in os.walk(os.path.join(ROOT, "web", "public")):
        for name in files:
            if name.endswith(".json"):
                with open(os.path.join(root, name), encoding="utf-8") as f:
                    text = f.read()
                assert "noise_bar_sigma" not in text and "nothing_moves" not in text, name


def test_roundtrip_within_half_a_step(tmp_path):
    rng = np.random.default_rng(1)
    src = rng.normal(0, 1, (3, 20, 20)) + 4000 * (rng.random((3, 20, 20)) > 0.99)
    src[0, 0, 0] = np.nan
    scale, offset = ew.write_u16(src, tmp_path / "f.u16")
    back = ew.read_u16(tmp_path / "f.u16", src.shape, scale, offset)
    assert np.array_equal(np.isnan(src), np.isnan(back))
    assert np.nanmax(np.abs(src - back)) <= scale / 2 + 1e-9


@pytest.mark.parametrize("slug", SLUGS)
def test_export_equals_fits_within_half_a_step(slug):
    if not has_fits(slug):
        pytest.skip("no frames.fits (gitignored)")
    field, frames, _ = load(slug)
    assert field["data"]["precision"] == "float"
    src = ew.frames_from_fits(os.path.join(ROOT, SPOT[slug]["folder"]))[0]
    assert np.array_equal(np.isnan(src), np.isnan(frames))
    assert np.nanmax(np.abs(src - frames)) <= field["data"]["scale"] / 2 + 1e-9


@pytest.mark.parametrize("slug", SLUGS)
def test_png_fallback_equals_fits_within_one_level(slug):
    """The PNG fallback reads the same native grid, with the same orientation, as the FITS."""
    if not has_fits(slug):
        pytest.skip("no frames.fits (gitignored)")
    from PIL import Image
    folder = os.path.join(ROOT, SPOT[slug]["folder"])
    fits_frames = ew.frames_from_fits(folder)[0]
    levels_fits = ew.gray_levels(fits_frames, ew.white_point(fits_frames)).astype(int)
    h = fits_frames.shape[1]
    for k in range(fits_frames.shape[0]):
        im = np.asarray(Image.open(os.path.join(folder, f"frame_{k + 1}.png")).convert("L"))
        levels_png = im[::im.shape[0] // h, ::im.shape[0] // h].astype(int)
        assert np.abs(levels_png - levels_fits[k]).max() <= 1
    # and the S/N it recovers is close where the preview is neither black nor white
    png_frames, _, _, _, white = ew.frames_from_png(folder, SPOT[slug]["fov"])
    mid = np.isfinite(fits_frames) & (fits_frames > -0.5) & (fits_frames < 0.5 * white)
    assert np.median(np.abs(png_frames - fits_frames)[mid]) < 0.1


@pytest.mark.parametrize("slug", [s for s in SLUGS if SPOT[s]["track"]])
def test_known_object_is_where_jpl_says(slug):
    field, frames, ans = load(slug)
    w, h = field["size"]
    obj = ans["objects"][0]
    assert obj["source"] == "JPL Horizons" and len(obj["positions"]) == len(field["frames"])
    inside = [p for p in obj["positions"] if p["in_grid"]]
    assert len(inside) >= 2                      # scoring needs a match in at least 2 frames
    for p in inside:
        assert -0.5 <= p["x"] <= w - 0.5 and -0.5 <= p["y"] <= h - 0.5


def test_eros_is_bright_at_its_track_while_in_the_picture():
    """Eros is fast: it is inside the 0.2 deg picture in frames 1-3 and has left by frame 4."""
    field, frames, ans = load("eros")
    pos = ans["objects"][0]["positions"]
    assert [p["in_grid"] for p in pos] == [True, True, True, False, False]
    for p in pos[:3]:
        x, y = int(round(p["x"])), int(round(p["y"]))
        assert np.nanmax(frames[p["frame"] - 1, y - 1:y + 2, x - 1:x + 2]) > 100   # rows top-down


def test_eris_bot_candidate_matches_jpl():
    """The bot's best Eris candidate, flipped to top-down, lands on the JPL track."""
    field, _, ans = load("eris")
    c = ans["bot"]["candidates"][0]
    for fr, p in zip(field["frames"], ans["objects"][0]["positions"]):
        dt = fr["mjd"] - ans["t_ref_mjd"]
        assert abs(c["x"] + c["vx_px_per_day"] * dt - p["x"]) < 2
        assert abs(c["y"] + c["vy_px_per_day"] * dt - p["y"]) < 2
    assert c["above_noise_bar"] and c["stacked_snr"] > ans["noise_bar_sigma"]


def test_cygnus_has_nothing_above_the_bar():
    _, _, ans = load("cygnus")
    assert ans["nothing_moves"] is True and ans["objects"] == []
    assert ans["noise_bar_sigma"] == 8.4
    assert not any(c["above_noise_bar"] or c["stacked_snr"] > ans["noise_bar_sigma"]
                   for c in ans["bot"]["candidates"])


@pytest.mark.parametrize("slug", [s for s in SLUGS if SPOT[s]["noise_bar"]])
def test_bot_flags_agree_with_the_bar(slug):
    _, _, ans = load(slug)
    for c in ans["bot"]["candidates"]:
        assert c["above_noise_bar"] == (c["stacked_snr"] > ans["noise_bar_sigma"])
