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
    # Undoing the stretch: the picture is exact (drawing the recovered values with the
    # recovered white point gives the preview back) ...
    png_frames, _, _, _, white = ew.frames_from_png(folder, SPOT[slug]["fov"])
    for k in range(fits_frames.shape[0]):
        im = np.asarray(Image.open(os.path.join(folder, f"frame_{k + 1}.png")).convert("L"))
        levels_png = im[::im.shape[0] // h, ::im.shape[0] // h].astype(int)
        redrawn = (ew.stretch_gray(png_frames[k], white) * 255).astype(int)
        assert np.abs(redrawn - levels_png).max() <= 1
    # ... and the S/N numbers are approximate: "preview quality". These are the measured
    # limits (worst case is Makemake), not a wish.
    seen = np.isfinite(fits_frames) & np.isfinite(png_frames)
    sky = seen & (fits_frames > -0.9) & (fits_frames < 3)
    stars = seen & (fits_frames >= 5) & (fits_frames < 50)
    assert np.median(np.abs(png_frames - fits_frames)[sky]) < 0.15
    assert np.median(np.abs(png_frames / fits_frames - 1)[stars]) < 0.3
    # no-data pixels: nearly the same set as in the FITS
    assert (np.isnan(png_frames) != np.isnan(fits_frames)).mean() < 0.01


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


@pytest.mark.parametrize("slug", [s for s in SLUGS if SPOT[s]["track"]])
def test_positions_carry_snr_and_change_snr(slug):
    _, _, ans = load(slug)
    for p in ans["objects"][0]["positions"]:
        if p["in_grid"]:
            assert "snr" in p and "change_snr" in p
            for key in ("snr", "change_snr"):
                assert p[key] is None or np.isfinite(p[key])
        else:
            assert "snr" not in p and "change_snr" not in p


def test_eros_change_snr_is_bright_while_in_the_picture():
    """Eros is fast: its residual (frame minus the others' median) stays bright in frames 1-3."""
    _, _, ans = load("eros")
    pos = ans["objects"][0]["positions"]
    for p in pos[:3]:
        assert p["in_grid"] and p["change_snr"] > 100


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


# ------------------------------------------------------------------ exposures (phase 2)
EXPOSURE_SLUGS = [s for s in SLUGS if os.path.exists(os.path.join(FIELDS, s, "exposures.json"))]


def test_some_spot_has_exposures():
    assert EXPOSURE_SLUGS, "no spot was exported with exposures"


@pytest.mark.parametrize("slug", SLUGS)
def test_has_flag_matches_files(slug):
    field, _, _ = load(slug)
    present = os.path.exists(os.path.join(FIELDS, slug, "exposures.u16"))
    assert field["has"]["exposures"] == present == (slug in EXPOSURE_SLUGS)
    if field["data"]["precision"] == "png8":
        assert not present


@pytest.mark.parametrize("slug", EXPOSURE_SLUGS)
def test_exposures_layout(slug):
    field, _, _ = load(slug)
    w, h = field["size"]
    planes, info = ew.read_exposures(os.path.join(FIELDS, slug))
    assert info["size"] == [w, h] and info["count"] == len(info["exposures"])
    assert os.path.getsize(os.path.join(FIELDS, slug, "exposures.u16")) == 2 * info["count"] * h * w
    assert [e["k"] for e in info["exposures"]] == list(range(info["count"]))
    for fr in field["frames"]:
        mine = [e for e in info["exposures"] if e["frame"] == fr["i"]]
        assert len(mine) == fr["n_bands"]
        assert sorted({e["detector"] for e in mine}) == fr["detectors"]
        assert all(abs(e["mjd"] - fr["mjd"]) < 0.02 for e in mine)       # within one burst
    for e in info["exposures"]:
        assert e["scale"] <= e["noise"] / 2 * 1.0001 and e["noise"] > 0
        grid = e["wavelength_um"]
        assert len(grid) == 8 and all(len(row) == 8 for row in grid)
        vals = [v for row in grid for v in row if v is not None]
        assert vals and all(0.7 < v < 5.1 for v in vals)                 # SPHEREx: 0.75-5.0 um
        assert max(vals) - min(vals) < 0.6          # one detector position, a narrow range
        assert np.isfinite(planes[e["k"]]).mean() > 0.2


@pytest.mark.parametrize("slug", EXPOSURE_SLUGS)
def test_exposures_rebuild_the_frames(slug):
    """Merging a frame's exposures the documented way gives back frames.u16."""
    field, frames, _ = load(slug)
    planes, info = ew.read_exposures(os.path.join(FIELDS, slug))
    for fr in field["frames"]:
        ks = [e["k"] for e in info["exposures"] if e["frame"] == fr["i"]]
        rebuilt = ew.rebuild_frame([planes[k] for k in ks],
                                   [info["exposures"][k]["noise"] for k in ks])
        both = np.isfinite(rebuilt) & np.isfinite(frames[fr["i"] - 1])
        assert both.sum() > 0.8 * np.isfinite(frames[fr["i"] - 1]).sum()
        err = np.abs(rebuilt - frames[fr["i"] - 1])[both]
        assert np.median(err) < 0.1 and np.percentile(err, 99) < 2.0     # in noise sigmas


@pytest.mark.parametrize("slug", SLUGS)
def test_utc_strings_match_frames_csv(slug):
    with open(os.path.join(FIELDS, slug, "field.json"), encoding="utf-8") as f:
        field = json.load(f)
    rows = ew.read_frames_csv(os.path.join(ROOT, SPOT[slug]["folder"]))
    assert [fr["utc"] for fr in field["frames"]] == [r["utc"] for r in rows]


def test_mjd_to_utc_truncates_to_the_second():
    # 0.752824 d = 65043.9936 s = 18 h 4 min 3.9936 s, so truncation gives :03, not :04
    assert ew.mjd_to_utc(60865.752824) == "2025-07-09T18:04:03"


def test_star_targets_are_refused():
    with pytest.raises(NotImplementedError):
        ew.answer_key("x", None, [1.0], star="Barnard")


def test_public_guard_refuses_answers_under_public(tmp_path):
    with pytest.raises(ValueError):
        ew.export_field(str(tmp_path / "x"), "x", "t", "easy",
                        str(tmp_path / "web" / "public" / "fields"),
                        answers_dir=str(tmp_path / "web" / "public" / "answers"))


# ------------------------------------------------------------------ sample (no FITS needed)
SAMPLE_PATH = os.path.join(HERE, "ref", "fits_sample.json")


@pytest.mark.parametrize("slug", SLUGS)
def test_committed_frames_match_fits_sample(slug):
    """Like test_export_equals_fits_within_half_a_step, but reads only the committed sample
    (ref/fits_sample.json, made by make_fits_sample.py from frames.fits). Never opens frames.fits."""
    with open(SAMPLE_PATH, encoding="utf-8") as f:
        sample = json.load(f)[slug]
    field, frames, _ = load(slug)
    assert list(frames.shape) == sample["shape"]
    flat = frames.reshape(-1)
    idx = np.array(sample["index"])
    got = flat[idx]
    want = np.array([np.nan if v is None else v for v in sample["value"]], dtype=float)
    assert np.array_equal(np.isnan(want), np.isnan(got))
    ok = ~np.isnan(want)
    assert np.all(np.abs(got[ok] - want[ok]) <= field["data"]["scale"] / 2 + 1e-6)


# ------------------------------------------------------------------ metadata and leaks
@pytest.mark.parametrize("slug", SLUGS)
def test_frame_metadata_matches_frames_csv(slug):
    field, _, _ = load(slug)
    rows = ew.read_frames_csv(os.path.join(ROOT, SPOT[slug]["folder"]))
    assert len(rows) == len(field["frames"])
    for k, row in enumerate(rows):
        fr = field["frames"][k]
        assert fr["n_bands"] == row["n_bands"]
        assert fr["detectors"] == row["detectors"]
        assert abs(fr["hours_since_prev"] - row["hours_since_prev"]) <= 0.011


ANSWER_KEYS = {"positions", "candidates", "objects", "bot", "noise_bar_sigma", "nothing_moves",
               "t_ref_mjd", "above_noise_bar", "stacked_snr", "reveal"}


def _all_keys(obj):
    """Every dictionary key anywhere in a parsed JSON value."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _all_keys(v)


def test_no_answer_data_in_any_public_file():
    public = os.path.join(ROOT, "web", "public")
    for root, _, files in os.walk(public):
        for name in files:
            if not name.endswith(".json"):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            leaked = sorted(set(_all_keys(data)) & ANSWER_KEYS)
            assert not leaked, f"{os.path.relpath(path, ROOT)} has answer key(s): {leaked}"
