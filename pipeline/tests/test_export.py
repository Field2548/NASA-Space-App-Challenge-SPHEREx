"""Checks on the exported ready spots (contract: docs/contracts/field-schema.md).
They read the committed export, so they need no network. Tests that compare against
frames.fits are skipped when that (gitignored) file is absent."""
import json
import os
import re
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
        assert e["noise"] > 0 and ("scale" in e or (e["soft"] == e["noise"] and e["step"] > 0))
        grid = e["wavelength_um"]
        assert len(grid) == 8 and all(len(row) == 8 for row in grid)
        vals = [v for row in grid for v in row if v is not None]
        assert vals and all(0.7 < v < 5.1 for v in vals)                 # SPHEREx: 0.75-5.0 um
        assert max(vals) - min(vals) < 0.6          # one detector position, a narrow range
        assert np.isfinite(planes[e["k"]]).mean() > 0.2


def test_asinh_plane_roundtrip_has_no_clipping_and_old_rows_still_decode():
    """soft * sinh((value - 32767) * step): faint sky within a tiny fraction of the noise, the
    brightest pixel (25000 sigma) kept, NaN -> 65535; a linear row (scale/offset) still decodes."""
    noise = 0.0127
    plane = np.random.default_rng(0).normal(0, noise, (40, 40))
    plane[3, 4], plane[5, 6], plane[7, 8] = 320.0, -2.0, np.nan
    q, soft, step, clipped = ew.quantize_plane(plane, noise)
    assert clipped is False and q[7, 8] == ew.NODATA and np.sum(q == ew.NODATA) == 1
    row = {"soft": soft, "step": step}
    back = ew.decode_exposure(q, row)
    assert np.isnan(back[7, 8])
    ok = np.isfinite(plane)
    sky = ok & (np.abs(plane) < 5 * noise)
    assert np.abs(back - plane)[sky].max() < 0.01 * noise
    assert abs(back[3, 4] - 320.0) / 320.0 < 1e-3 and abs(back[5, 6] + 2.0) / 2.0 < 1e-3
    lin = ew.decode_exposure(np.array([0, 10, ew.NODATA]), {"scale": 0.5, "offset": -1.0})
    assert lin[0] == -1.0 and lin[1] == 4.0 and np.isnan(lin[2])


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


# ------------------------------------------------------------------ neutral public files (issue #10)
GIVEAWAYS = ["Eros", "Hektor", "Makemake", "Eris", "control", "624", "136472", "136199",
             "asteroid", "dwarf"]
# "433" is also a substring of Eris's dec (-0.4338), so for it only the title, kind and
# difficulty values are checked (not the raw text).


def _read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_public_files_do_not_name_the_answer():
    for slug in SLUGS:
        text = _read_text(os.path.join(FIELDS, slug, "field.json"))
        for word in GIVEAWAYS:
            assert word not in text, f"{slug}/field.json contains {word!r}"
        field = json.loads(text)
        for value in (field["title"], field["kind"], field["difficulty"]):
            assert "433" not in value, f"{slug}/field.json contains '433' in {value!r}"
    text = _read_text(os.path.join(FIELDS, "index.json"))
    for word in GIVEAWAYS:
        assert word not in text, f"index.json contains {word!r}"
    for entry in json.loads(text):
        for value in (entry["title"], entry["kind"], entry["difficulty"]):
            assert "433" not in value, f"index.json contains '433' in {value!r}"


PUBLIC = os.path.join(ROOT, "web", "public")
NAME_WORDS = ["Eros", "Hektor", "Makemake", "Eris", "Cygnus control", "asteroid", "dwarf"]
CATALOGUE_NUMBERS = re.compile(r"(?<!\d)(433|624|136472|136199)(?!\d)")
# Narrow, documented exceptions (file relative to web/public, exact string value): generic
# reference tables about stars, not about any spot, that contain the ordinary word "dwarf".
NAME_EXCEPTIONS = {
    ("ref/molecule_bands.json", "Gas in cool star and brown-dwarf atmospheres"),
    ("ref/spt_teff.json",
     'https://www.pas.rochester.edu/~emamajek/EEM_dwarf_UBVIJHK_colors_Teff.txt (Eric Mamajek, '
     '"A Modern Mean Dwarf Stellar Color and Effective Temperature Sequence"); columns SpT and '
     'Teff only, parsed verbatim by script, no values typed by hand'),
}


def _public_json_files():
    found = []
    for root, _, files in os.walk(PUBLIC):
        for name in sorted(files):
            if name.endswith(".json"):
                found.append(os.path.join(root, name))
    return sorted(found)


def _string_values(obj):
    """Every string VALUE anywhere in a parsed JSON value (keys and numbers are skipped)."""
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _string_values(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _string_values(v)
    elif isinstance(obj, str):
        yield obj


def test_no_public_json_names_an_object():
    """Walks EVERY .json under web/public/ (fields, spectrum, exposures, ref, ...), not only
    field.json and index.json, and fails (naming file and value) if a string VALUE
      - contains, case-sensitively, Eros, Hektor, Makemake, Eris, "Cygnus control", asteroid or dwarf,
      - equals "control", or
      - contains 433, 624, 136472 or 136199 as a whole token: the digits must not touch another
        digit on either side (regex (?<!\\d)(...)(?!\\d)). So an id such as "2025W28_1B_0433_2"
        is judged by the rule too: "_0433_" has a 0 right before 433, so it is NOT the number
        433 and passes, while "433 Eros" or "(433)" or "A433" would fail. Plain decimals like
        13.2004 are JSON numbers, not strings, and are never examined.
    Keys and numbers are ignored; "Field in Cygnus" is allowed (a constellation).
    Exceptions are exact (file, value) pairs in NAME_EXCEPTIONS: two generic star-reference
    strings with the word "dwarf" under ref/."""
    files = _public_json_files()
    assert len(files) >= 20, files               # the walk really reaches all of web/public
    examined = 0
    for path in files:
        rel = os.path.relpath(path, PUBLIC).replace(os.sep, "/")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for value in _string_values(data):
            examined += 1
            if (rel, value) in NAME_EXCEPTIONS:
                continue
            bad = [w for w in NAME_WORDS if w in value]
            if value == "control":
                bad.append("control")
            m = CATALOGUE_NUMBERS.search(value)
            if m:
                bad.append(m.group(1))
            assert not bad, f"{rel} has string value {value!r} that gives away {bad}"
    assert examined > 100, examined


def _number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _pairs(obj):
    """Every pair of numbers that sits together: a 2-element list [a, b] of numbers, or an object
    with numeric keys x and y."""
    if isinstance(obj, dict):
        if _number(obj.get("x")) and _number(obj.get("y")):
            yield (obj["x"], obj["y"])
        for v in obj.values():
            yield from _pairs(v)
    elif isinstance(obj, list):
        if len(obj) == 2 and all(_number(v) for v in obj):
            yield (obj[0], obj[1])
        for v in obj:
            yield from _pairs(v)


def test_no_public_json_holds_answer_positions():
    """Guards against the answer positions leaking under a neutral key. test_no_answer_data_in_any_public_file
    only compares key names, so a copy of the JPL track stored as {"track": [[51.2, 63.9], ...]} or
    {"pts": [{"x": ..., "y": ...}]} would pass it. Here, for each real spot with a known object, every
    in_grid position of web/data/answers/<slug>.json is compared with every number pair found in the
    spot's public JSON files (field.json, exposures.json, spectrum/index.json) and in index.json: a
    pair is a 2-element list of numbers or an object with numeric x and y, and it fails if it is
    within 0.15 px of an answer position as (x, y), whatever its key. The number of pairs examined is
    asserted to be above zero in total (so the test cannot pass by examining nothing) and the
    measured count per spot is in the failure message."""
    index_pairs = list(_pairs(json.load(open(os.path.join(FIELDS, "index.json"), encoding="utf-8"))))
    total = 0
    counts = {}
    for slug in SLUGS:
        with open(os.path.join(ANSWERS, f"{slug}.json"), encoding="utf-8") as f:
            ans = json.load(f)
        answers = [(p["x"], p["y"]) for o in ans["objects"] for p in o["positions"] if p["in_grid"]]
        if not answers:
            continue
        pairs = list(index_pairs)
        for root, _, files in os.walk(os.path.join(FIELDS, slug)):
            for name in files:
                if name.endswith(".json"):
                    with open(os.path.join(root, name), encoding="utf-8") as f:
                        for pair in _pairs(json.load(f)):
                            pairs.append(pair)
        counts[slug] = len(pairs)
        total += len(pairs)
        for (a, b) in pairs:
            for (x, y) in answers:
                assert not (abs(a - x) < 0.15 and abs(b - y) < 0.15), \
                    f"{slug}: public pair {(a, b)} is within 0.15 px of the answer position {(x, y)}"
    assert total > 0, counts


def test_public_title_kind_difficulty():
    with open(os.path.join(FIELDS, "index.json"), encoding="utf-8") as f:
        index = {e["slug"]: e for e in json.load(f)}
    for slug in SLUGS:
        with open(os.path.join(FIELDS, slug, "field.json"), encoding="utf-8") as f:
            field = json.load(f)
        assert field["title"].startswith("Field in ")
        assert field["kind"] == "spot"
        assert field["difficulty"] in ("easy", "medium", "hard", "boss", "tool")
        entry = index[slug]
        assert (entry["title"], entry["kind"], entry["difficulty"]) == \
            (field["title"], field["kind"], field["difficulty"])


def test_reveal_block():
    for slug in SLUGS:
        with open(os.path.join(ANSWERS, f"{slug}.json"), encoding="utf-8") as f:
            ans = json.load(f)
        assert ans["reveal"] == {"title": SPOT[slug]["title"], "kind": SPOT[slug]["kind"],
                                 "difficulty": SPOT[slug]["difficulty"]}


def test_fixture_is_unchanged_by_the_neutral_titles():
    with open(os.path.join(FIELDS, "fixture", "field.json"), encoding="utf-8") as f:
        assert json.load(f)["kind"] == "fixture"
    with open(os.path.join(ANSWERS, "fixture.json"), encoding="utf-8") as f:
        assert json.load(f)["reveal"] == {"title": "Fixture (synthetic test spot)",
                                          "kind": "fixture", "difficulty": "easy"}


# ------------------------------------------------------------------ bot candidate status
def _bot_by_rank(slug):
    _, _, ans = load(slug)
    return ans, {c["rank"]: c for c in ans["bot"]["candidates"]}


@pytest.mark.parametrize("slug", SLUGS)
def test_bot_candidate_status_values(slug):
    _, _, ans = load(slug)
    for c in ans["bot"]["candidates"]:
        assert c["status"] in ("known", "alias", "unconfirmed"), (slug, c["rank"])
        named = c["status"] in ("known", "alias")
        assert ("object_id" in c) == named, (slug, c["rank"])
        assert ("near_object_frames" in c) == named, (slug, c["rank"])


def test_bot_candidate_status_matches_the_measured_cases():
    _, hek = _bot_by_rank("hektor")
    assert hek[1]["status"] == "known" and hek[1]["object_id"] == "624"
    assert hek[2]["status"] == "unconfirmed" and hek[3]["status"] == "unconfirmed"
    _, eris = _bot_by_rank("eris")
    assert eris[1]["status"] == "known" and eris[1]["object_id"] == "136199"
    assert eris[1]["near_object_frames"] == list(range(1, 11))     # on Eris in all 10 frames
    _, mm = _bot_by_rank("makemake")
    assert mm[1]["status"] == "known"
    ans, _ = _bot_by_rank("cygnus")
    assert ans["bot"]["candidates"] and all(c["status"] == "unconfirmed"
                                            for c in ans["bot"]["candidates"])


@pytest.mark.parametrize("slug", ["hektor", "eris", "makemake"])
def test_unconfirmed_candidates_match_no_catalogued_body(slug):
    field, _, ans = load(slug)
    with open(os.path.join(ROOT, "web", "data", "catalog", f"{slug}.json"), encoding="utf-8") as f:
        catalog = json.load(f)
    mjds = [fr["mjd"] for fr in field["frames"]]
    close = []
    for c in ans["bot"]["candidates"]:
        if c["status"] != "unconfirmed" or not c["above_noise_bar"]:
            continue
        for body in catalog["asteroids"]:
            for p in body["positions"]:
                dt = mjds[p["frame"] - 1] - ans["t_ref_mjd"]
                x = c["x"] + c["vx_px_per_day"] * dt
                y = c["y"] + c["vy_px_per_day"] * dt
                d = ((x - p["x"]) ** 2 + (y - p["y"]) ** 2) ** 0.5
                if d <= 4:
                    close.append((c["rank"], body["name"], p["frame"], round(d, 2)))
    assert not close, close


def test_candidate_status_on_made_up_numbers():
    mjds = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    t_ref = 2.0
    obj = {"id": "900", "positions": [
        {"frame": i + 1, "x": 10 + 2 * m, "y": 20 - m, "in_grid": True}   # x = 10 + 2m, y = 20 - m
        for i, m in enumerate(mjds)]}

    def cand(x0, y0, vx, vy):
        return {"x": x0, "y": y0, "vx_px_per_day": vx, "vy_px_per_day": vy}

    st = ew.candidate_status
    assert st(cand(14, 18, 2, -1), mjds, t_ref, [obj]) == {
        "status": "known", "object_id": "900", "near_object_frames": [1, 2, 3, 4, 5]}
    assert st(cand(24, 14, -3, 1), mjds, t_ref, [obj]) == {
        "status": "alias", "object_id": "900", "near_object_frames": [5]}
    assert st(cand(100, 100, 0, 0), mjds, t_ref, [obj]) == {"status": "unconfirmed"}
    short = {"id": "901", "positions": [dict(p, in_grid=p["frame"] >= 4) for p in obj["positions"]]}
    assert st(cand(14, 18, 2, -1), mjds, t_ref, [short]) == {
        "status": "known", "object_id": "901", "near_object_frames": [4, 5]}


def test_eros_answer_key_matches_recorded_horizons_reply():
    """The key is where JPL Horizons puts Eros for SPHEREx as observer at mid-exposure
    (reply recorded in ref/horizons_eros.json), mapped through the field's own WCS."""
    from astropy.coordinates import SkyCoord
    from astropy.wcs import WCS
    with open(os.path.join(HERE, "ref", "horizons_eros.json"), encoding="utf-8") as f:
        ref = json.load(f)
    field, _, ans = load("eros")
    c = field["wcs"]
    w = WCS(naxis=2)
    w.wcs.ctype, w.wcs.crval, w.wcs.crpix, w.wcs.cdelt = c["ctype"], c["crval"], c["crpix"], c["cdelt"]
    x, y = w.world_to_pixel(SkyCoord(ref["RA"], ref["DEC"], unit="deg"))
    y = field["size"][1] - 1 - y                  # the key is top-down, the WCS above bottom-up
    for p, xk, yk in zip(ans["objects"][0]["positions"], x, y):
        assert abs(p["x"] - xk) < 0.02 and abs(p["y"] - yk) < 0.02
