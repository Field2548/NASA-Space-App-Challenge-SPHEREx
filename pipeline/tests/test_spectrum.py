"""Checks on the spectrum tiles (contract: docs/contracts/field-schema.md section 8).
They read the committed tiles, so they need no network. Tests that compare against the
(gitignored) data/bands_<slug>/cube.fits are skipped when it is absent."""
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
SLUGS = [s["slug"] for s in ew.SPOTS]
TILE = 32


def spot_dir(slug):
    return os.path.join(FIELDS, slug)


def load_field(slug):
    with open(os.path.join(spot_dir(slug), "field.json"), encoding="utf-8") as f:
        return json.load(f)


def load_index(slug):
    with open(os.path.join(spot_dir(slug), "spectrum", "index.json"), encoding="utf-8") as f:
        return json.load(f)


def has_tiles(slug):
    return os.path.exists(os.path.join(spot_dir(slug), "spectrum", "index.json"))


SPECTRUM_SLUGS = [s for s in SLUGS if has_tiles(s)]
needs_tiles = pytest.mark.skipif(not SPECTRUM_SLUGS, reason="no spectrum tiles exported yet")


def decode_pixel_slow(slug, idx, b, x, y):
    """Value of band b at pixel (x, y) by the contract's formula, one pixel at a time."""
    tx, ty = (x - idx["origin"][0]) // TILE, (y - idx["origin"][1]) // TILE
    tile = np.fromfile(os.path.join(spot_dir(slug), "spectrum", f"t_{tx}_{ty}.u16"), dtype="<u2")
    v = tile[(b * TILE + (y - idx["origin"][1]) % TILE) * TILE + (x - idx["origin"][0]) % TILE]
    e = idx["bands"][b]
    return np.nan if v == 65535 else v * e["scale"] + e["offset"]


def decode_cube(slug):
    """All tiles -> (B x H x W MJy/sr with NaN, B x H x W raw u16 values), rows top-down."""
    idx = load_index(slug)
    w, h = idx["size"]
    nb = len(idx["bands"])
    raw = np.full((nb, idx["ny"] * TILE, idx["nx"] * TILE), 65535, dtype="<u2")
    for ty in range(idx["ny"]):
        for tx in range(idx["nx"]):
            t = np.fromfile(os.path.join(spot_dir(slug), "spectrum", f"t_{tx}_{ty}.u16"), dtype="<u2")
            raw[:, ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE] = t.reshape(nb, TILE, TILE)
    raw = raw[:, :h, :w]
    scale = np.array([e["scale"] for e in idx["bands"]])[:, None, None]
    offset = np.array([e["offset"] for e in idx["bands"]])[:, None, None]
    return np.where(raw == 65535, np.nan, raw * scale + offset), raw


def cube_fits(slug):
    """The source cube with rows flipped to top-down, or skip when it is not on this machine."""
    path = os.path.join(ROOT, "data", f"bands_{slug}", "cube.fits")
    if not os.path.exists(path):
        pytest.skip(f"{path} not present (gitignored)")
    from astropy.io import fits
    with fits.open(path) as hdul:
        return np.asarray(hdul[0].data, dtype=np.float64)[:, ::-1, :]


@needs_tiles
@pytest.mark.parametrize("slug", SPECTRUM_SLUGS)
def test_index_keys_and_counts(slug):
    idx = load_index(slug)
    field = load_field(slug)
    assert idx["size"] == field["size"]
    assert idx["tile"] == TILE and idx["origin"] == [0, 0] and idx["covered"] == idx["size"]
    assert idx["units"] == "MJy/sr" and idx["nodata"] == 65535
    w, h = idx["size"]
    assert (idx["nx"], idx["ny"]) == (-(-w // TILE), -(-h // TILE))
    keys = {"band", "detector", "wavelength_um", "bandwidth_um", "date_obs", "scale", "offset", "noise"}
    bands = idx["bands"]
    assert 0 < len(bands) <= 102
    for e in bands:
        assert keys <= set(e) <= keys | {"clipped"}
        assert 1 <= e["band"] <= 102 and 1 <= e["detector"] <= 6
        assert e["scale"] > 0 and e["noise"] > 0
        assert e["scale"] <= e["noise"] / 2 * (1 + 1e-6)          # step never above noise / 2
    assert len({e["band"] for e in bands}) == len(bands)           # real band numbers, no repeats


@needs_tiles
@pytest.mark.parametrize("slug", SPECTRUM_SLUGS)
def test_tile_files(slug):
    idx = load_index(slug)
    folder = os.path.join(spot_dir(slug), "spectrum")
    tiles = sorted(n for n in os.listdir(folder) if n.endswith(".u16"))
    assert len(tiles) == idx["nx"] * idx["ny"]
    expected = {f"t_{tx}_{ty}.u16" for tx in range(idx["nx"]) for ty in range(idx["ny"])}
    assert set(tiles) == expected
    for name in tiles:
        assert os.path.getsize(os.path.join(folder, name)) == 2 * len(idx["bands"]) * TILE * TILE


@needs_tiles
@pytest.mark.parametrize("slug", SPECTRUM_SLUGS)
def test_wavelengths_ascend_within_detector(slug):
    bands = load_index(slug)["bands"]
    for e in bands:
        assert 0.7 <= e["wavelength_um"] <= 5.1
    for det in {e["detector"] for e in bands}:
        wl = [e["wavelength_um"] for e in bands if e["detector"] == det]
        assert wl == sorted(wl) and len(set(wl)) == len(wl)
    # band numbers run in wavelength order too
    nums = [e["band"] for e in bands]
    assert nums == sorted(nums)


@needs_tiles
@pytest.mark.parametrize("slug", SPECTRUM_SLUGS)
def test_padding_is_nodata(slug):
    idx = load_index(slug)
    w, h = idx["size"]
    _, raw = decode_cube(slug)
    nb = len(idx["bands"])
    full = np.full((nb, idx["ny"] * TILE, idx["nx"] * TILE), 0, dtype="<u2")
    for ty in range(idx["ny"]):
        for tx in range(idx["nx"]):
            t = np.fromfile(os.path.join(spot_dir(slug), "spectrum", f"t_{tx}_{ty}.u16"), dtype="<u2")
            full[:, ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE] = t.reshape(nb, TILE, TILE)
    assert (full[:, h:, :] == 65535).all() and (full[:, :, w:] == 65535).all()


@needs_tiles
@pytest.mark.parametrize("slug", SPECTRUM_SLUGS)
def test_round_trip_against_cube(slug):
    idx = load_index(slug)
    src = cube_fits(slug)
    keep = [e["band"] - 1 for e in idx["bands"]]
    dropped = sorted(set(range(src.shape[0])) - set(keep))
    assert not np.isfinite(src[dropped]).any()               # only empty bands were left out
    dec, _ = decode_cube(slug)
    src = src[keep]
    assert np.array_equal(np.isfinite(src), np.isfinite(dec))        # same NaN pattern
    for b, e in enumerate(idx["bands"]):
        ok = np.isfinite(src[b])
        err = np.abs(dec[b][ok] - src[b][ok])
        if e.get("clipped"):
            top = e["scale"] * 65534 + e["offset"]
            err = err[src[b][ok] <= top]                      # clipped pixels are the exception
        assert err.max() <= e["scale"] / 2 * (1 + 1e-6) + 1e-9, (slug, e["band"])
    # the one-pixel reader of the contract text agrees with the bulk decoder
    w, h = idx["size"]
    for b, x, y in [(0, 0, 0), (len(keep) // 2, w - 1, h - 1), (len(keep) - 1, w // 2, h // 3)]:
        a, c = decode_pixel_slow(slug, idx, b, x, y), dec[b, y, x]
        assert (np.isnan(a) and np.isnan(c)) or a == c


@needs_tiles
@pytest.mark.parametrize("slug", SLUGS)
def test_has_flag_matches_files(slug):
    on_disk = has_tiles(slug)
    assert load_field(slug)["has"]["spectrum"] is on_disk


def peak_shift(slug, search=3):
    """Shift (dx, dy) of the cube's band-averaged picture that best matches frame 1 of
    frames.u16, by correlation over shifts of up to `search` pixels. (0, 0) means the cube
    and the motion frames share one pixel grid."""
    field = load_field(slug)
    w, h = field["size"]
    d = field["data"]
    frame = ew.read_u16(os.path.join(spot_dir(slug), d["file"]), (len(field["frames"]), h, w),
                        d["scale"], d["offset"])[0]
    cube, _ = decode_cube(slug)
    with np.errstate(all="ignore"):
        mean = np.nanmedian(cube, axis=0)
    a = np.nan_to_num(frame - np.nanmedian(frame))
    b = np.nan_to_num(mean - np.nanmedian(mean))
    best = None
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            s = np.roll(np.roll(b, dy, axis=0), dx, axis=1)[search:-search, search:-search]
            c = float((a[search:-search, search:-search] * s).sum())
            if best is None or c > best[0]:
                best = (c, dx, dy)
    return best[1], best[2], frame, mean


@needs_tiles
@pytest.mark.parametrize("slug", SPECTRUM_SLUGS)
def test_star_positions_match_motion_frames(slug):
    dx, dy, frame, mean = peak_shift(slug)
    assert (dx, dy) == (0, 0)
    # the brightest star of the cube is a bright pixel of frame 1 at the same (x, y)
    seen = np.where(np.isfinite(frame), mean, np.nan)          # frame 1 does not cover every pixel
    y, x = np.unravel_index(np.nanargmax(seen), mean.shape)
    box = frame[max(y - 1, 0):y + 2, max(x - 1, 0):x + 2]
    assert np.nanmax(box) > np.nanpercentile(frame, 99)
