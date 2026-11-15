"""Tests for pipeline/process_requests.py. No network, no subprocess, no git.

Run with pytest, or without it (the __main__ block calls every test_* function):
    .venv\\Scripts\\python.exe pipeline/tests/test_process_requests.py
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import process_requests as pr  # noqa: E402

SECRET = "sb_secret_TESTKEY_do_not_print_123"
BASE = "https://example-project.supabase.co"
ENV_KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
REQ = {"id": 7, "ra": 133.795, "dec": -7.245, "fov": 0.2, "status": "queued"}


@contextlib.contextmanager
def fake_env(**values):
    """Set exactly these Supabase variables (others removed), restore afterwards."""
    saved = {k: os.environ.get(k) for k in ENV_KEYS}
    try:
        for k in ENV_KEYS:
            os.environ.pop(k, None)
        for k, v in values.items():
            os.environ[k] = v
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@contextlib.contextmanager
def temp_dir():
    d = tempfile.mkdtemp(prefix="process_requests_test_")
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


def capture(fn, *a, **kw):
    """Run fn, return (result, stdout text)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = fn(*a, **kw)
    return result, buf.getvalue()


class FakeSupabase:
    """Stands in for default_http. Serves `rows` on GET, records every PATCH."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []
        self.patches = []  # (rid, status)

    def __call__(self, method, url, headers, body=None):
        self.calls.append((method, url))
        if method == "GET":
            return list(self.rows)
        if method == "PATCH":
            rid = int(url.split("id=eq.")[1])
            self.patches.append((rid, body["status"]))
            return None
        raise AssertionError(f"unexpected HTTP method {method}")


class FakeRun:
    """Stands in for default_run. `codes` is a list of exit codes, one per call (then 0)."""

    def __init__(self, codes=None):
        self.codes = list(codes or [])
        self.cmds = []

    def __call__(self, cmd):
        self.cmds.append(cmd)
        return self.codes.pop(0) if self.codes else 0


def _opts(frames=None, min_spacing=None):
    import types
    return types.SimpleNamespace(frames=frames, min_spacing=min_spacing)


# ---------------------------------------------------------------- load_env

def test_load_env_parses_quotes_comments_and_blank_lines():
    with temp_dir() as d:
        path = os.path.join(d, ".env")
        with open(path, "w", encoding="utf-8") as f:
            f.write("# a comment line\n"
                    "\n"
                    "SUPABASE_URL=https://plain.example.co   # trailing comment\n"
                    "SUPABASE_SERVICE_ROLE_KEY=\"quoted # not a comment\"\n"
                    "export NEXT_PUBLIC_SUPABASE_URL='single quoted'\n"
                    "   \n"
                    "NO_EQUALS_SIGN\n"
                    "EMPTY=\n")
        env = pr.load_env(path)
    assert env["SUPABASE_URL"] == "https://plain.example.co", env
    assert env["SUPABASE_SERVICE_ROLE_KEY"] == "quoted # not a comment", env
    assert env["NEXT_PUBLIC_SUPABASE_URL"] == "single quoted", env
    assert env["EMPTY"] == "", env
    assert "NO_EQUALS_SIGN" not in env


def test_load_env_missing_file_is_empty():
    with temp_dir() as d:
        assert pr.load_env(os.path.join(d, "nope.env")) == {}


# ---------------------------------------------------------------- missing settings

def test_missing_settings_exit_2_and_no_key_in_message():
    with temp_dir() as d, fake_env(SUPABASE_SERVICE_ROLE_KEY=SECRET):
        http, run = FakeSupabase([REQ]), FakeRun()
        code, out = capture(pr.main, ["--env", os.path.join(d, "none.env"), "--list"],
                            http=http, run=run)
    assert code == 2, code
    assert "SUPABASE_URL" in out, out
    assert SECRET not in out
    assert http.calls == [] and run.cmds == []


def test_missing_key_exit_2_and_message_names_it():
    with temp_dir() as d, fake_env(SUPABASE_URL=BASE):
        http = FakeSupabase([REQ])
        code, out = capture(pr.main, ["--env", os.path.join(d, "none.env"), "--list"], http=http)
    assert code == 2, code
    assert "SUPABASE_SERVICE_ROLE_KEY" in out, out
    assert http.calls == []


def test_settings_read_from_env_file():
    with temp_dir() as d:
        path = os.path.join(d, ".env")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"SUPABASE_URL={BASE}/\nSUPABASE_SERVICE_ROLE_KEY={SECRET}\n")
        with fake_env():
            http = FakeSupabase([])
            code, out = capture(pr.main, ["--env", path, "--list"], http=http)
    assert code == 0, out
    assert http.calls[0][1].startswith(BASE + "/rest/v1/spot_requests?status=eq.queued")
    assert "queue is empty" in out


# ---------------------------------------------------------------- commands

def test_build_commands_for_request_7():
    cmds = pr.build_commands(REQ, _opts())
    assert len(cmds) == 3, cmds
    motion, search, export = cmds
    assert os.path.basename(motion[1]) == "motion_frames.py", motion
    assert motion[2:] == ["133.795", "-7.245", "--fov", "0.2"], motion
    assert os.path.basename(search[1]) == "shift_stack.py", search
    folder = os.path.join("data", "motion_133.795_-7.245")
    assert search[2] == folder, search
    assert os.path.basename(export[1]) == "export_web.py", export
    assert export[2] == folder, export
    assert export[export.index("--slug") + 1] == "req-7", export
    assert export[export.index("--fov") + 1] == "0.2", export
    assert export[export.index("--difficulty") + 1] == "medium", export
    assert export[export.index("--title") + 1] == "Field at RA 133.795 Dec -7.245", export
    assert all(c[0] == sys.executable for c in cmds)


def test_build_commands_passes_frames_and_spacing_only_when_set():
    cmds = pr.build_commands(REQ, _opts(frames=5, min_spacing=20.0))
    motion = cmds[0]
    assert motion[motion.index("--frames") + 1] == "5", motion
    assert motion[motion.index("--min-spacing") + 1] == "20.0", motion
    plain = pr.build_commands(REQ, _opts())[0]
    assert "--frames" not in plain and "--min-spacing" not in plain, plain


def test_motion_folder_matches_motion_frames_format():
    assert pr.motion_folder(26.3271, -0.4338) == os.path.join("data", "motion_26.3271_-0.4338")
    assert pr.motion_folder(26.3271, -0.4338, "2026-01-06T00:47") == \
        os.path.join("data", "motion_26.3271_-0.4338_2026-01-06")
    assert pr.motion_folder(200, 21) == os.path.join("data", "motion_200.0_21.0")


def test_publish_commands_lines():
    lines = pr.publish_commands(REQ)
    assert lines[0] == ("git add web/public/fields/req-7 web/data/answers/req-7.json "
                        "web/public/fields/index.json"), lines
    assert lines[1].startswith("git commit -m"), lines
    assert lines[2] == "git push", lines


# ---------------------------------------------------------------- main flow

def test_dry_run_calls_neither_run_nor_patch():
    with temp_dir() as d, fake_env(SUPABASE_URL=BASE, SUPABASE_SERVICE_ROLE_KEY=SECRET):
        http, run = FakeSupabase([REQ]), FakeRun()
        code, out = capture(pr.main, ["--env", os.path.join(d, "none.env"), "--dry-run"],
                            http=http, run=run)
    assert code == 0, out
    assert run.cmds == [], run.cmds
    assert [m for m, _ in http.calls if m == "PATCH"] == [], http.calls
    assert "[dry run] motion_frames.py" in out, out
    assert SECRET not in out


def test_failing_step_marks_failed_and_next_request_still_runs():
    rows = [dict(REQ, id=7), dict(REQ, id=8, ra=10.0)]
    with temp_dir() as d, fake_env(SUPABASE_URL=BASE, SUPABASE_SERVICE_ROLE_KEY=SECRET):
        http, run = FakeSupabase(rows), FakeRun(codes=[3])  # first step of request 7 fails
        code, out = capture(pr.main, ["--env", os.path.join(d, "none.env"), "--limit", "2"],
                            http=http, run=run)
    assert code == 1, out
    assert http.patches == [(7, "processing"), (7, "failed"),
                            (8, "processing"), (8, "done")], http.patches
    assert len(run.cmds) == 4, run.cmds  # request 7 stopped after its first step
    assert "FAILED at step motion_frames.py (exit code 3)" in out, out
    assert SECRET not in out


def test_successful_request_marked_processing_then_done():
    with temp_dir() as d, fake_env(SUPABASE_URL=BASE, SUPABASE_SERVICE_ROLE_KEY=SECRET):
        http, run = FakeSupabase([REQ]), FakeRun()
        code, out = capture(pr.main, ["--env", os.path.join(d, "none.env")], http=http, run=run)
    assert code == 0, out
    assert http.patches == [(7, "processing"), (7, "done")], http.patches
    assert len(run.cmds) == 3, run.cmds
    assert "git push" in out, out
    assert SECRET not in out


def test_service_key_never_in_stdout():
    with temp_dir() as d, fake_env(SUPABASE_URL=BASE, SUPABASE_SERVICE_ROLE_KEY=SECRET):
        http, run = FakeSupabase([REQ]), FakeRun(codes=[0, 1])
        code, out = capture(pr.main, ["--env", os.path.join(d, "none.env")], http=http, run=run)
    assert SECRET not in out
    assert code == 1


# ---------------------------------------------------------------- runner

def _run_all():
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn)]
    passed = 0
    for name, fn in tests:
        try:
            fn()
        except Exception:
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            passed += 1
            print(f"ok   {name}")
    print(f"{passed} of {len(tests)} tests passed")
    return passed == len(tests)


if __name__ == "__main__":
    ok = _run_all()
    sys.exit(0 if ok else 1)
