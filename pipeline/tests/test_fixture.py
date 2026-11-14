"""Checks on the synthetic fixture spot and the u16 round trip (contract: field-schema.md)."""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
import export_web as ew  # noqa: E402
import make_fixture as mf  # noqa: E402

SPOT = os.path.join(ROOT, "web", "public", "fields", "fixture")


def load():
    with open(os.path.join(SPOT, "field.json"), encoding="utf-8") as f:
        field = json.load(f)
    w, h = field["size"]
    d = field["data"]
    frames = ew.read_u16(os.path.join(SPOT, d["file"]), (len(field["frames"]), h, w),
                         d["scale"], d["offset"])
    return field, frames


def test_roundtrip_within_half_a_step(tmp_path):
    src = mf.build()
    scale, offset = ew.write_u16(src, tmp_path / "f.u16")
    back = ew.read_u16(tmp_path / "f.u16", src.shape, scale, offset)
    assert np.array_equal(np.isnan(src), np.isnan(back))
    assert np.nanmax(np.abs(src - back)) <= scale / 2 + 1e-9


def test_committed_fixture_matches_the_script():
    field, frames = load()
    src = mf.build()
    assert os.path.getsize(os.path.join(SPOT, "frames.u16")) == 2 * src.size
    assert np.nanmax(np.abs(src - frames)) <= field["data"]["scale"] / 2 + 1e-9
    assert np.isnan(frames[:, 31, 31]).all()          # the no-data pixel
    assert len(field["thumbs"]) == len(field["frames"]) == 4
    for t in field["thumbs"]:
        assert os.path.exists(os.path.join(SPOT, t))


def test_answer_key_points_at_the_mover():
    field, frames = load()
    with open(os.path.join(ROOT, "web", "data", "answers", "fixture.json"), encoding="utf-8") as f:
        ans = json.load(f)
    obj = ans["objects"][0]
    for p in obj["positions"]:
        plane = frames[p["frame"] - 1]
        assert plane[p["y"], p["x"]] > 10             # rows top-down: plane[y, x]
    c = ans["bot"]["candidates"][0]
    for fr, p in zip(field["frames"], obj["positions"]):
        dt = fr["mjd"] - ans["t_ref_mjd"]
        assert abs(c["x"] + c["vx_px_per_day"] * dt - p["x"]) < 1e-6
        assert abs(c["y"] + c["vy_px_per_day"] * dt - p["y"]) < 1e-6
