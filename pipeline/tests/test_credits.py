"""scripts/credits-check.py: passes on the repo, fails on a broken copy (uses --root)."""
import csv
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "credits-check.py"


def run(root, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *args],
        capture_output=True, text=True,
    )


def make_copy(tmp_path):
    """A small copy of the repo parts the checker reads, with CREDITS.md freshly generated."""
    dst = tmp_path / "repo"
    (dst / "docs").mkdir(parents=True)
    shutil.copytree(ROOT / "docs" / "credits", dst / "docs" / "credits")
    (dst / "web").mkdir()
    shutil.copy(ROOT / "web" / "package.json", dst / "web" / "package.json")
    shutil.copytree(ROOT / "web" / "public" / "ref", dst / "web" / "public" / "ref")
    shutil.copy(ROOT / "LICENSE", dst / "LICENSE")
    first = run(dst)  # default mode writes CREDITS.md
    assert first.returncode == 0, first.stderr
    assert run(dst, "--check").returncode == 0
    return dst


def edit_rows(dst, fn):
    for path in (dst / "docs" / "credits").glob("*.csv"):
        with path.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            fields = reader.fieldnames
            rows = fn(list(reader))
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)


def test_repo_passes():
    r = run(ROOT, "--check")
    assert r.returncode == 0, r.stderr
    assert r.stdout.startswith("credits ok:")


def test_missing_dependency_row_fails(tmp_path):
    dst = make_copy(tmp_path)
    edit_rows(dst, lambda rows: [x for x in rows if not x["name"].lower().startswith("zod")])
    r = run(dst, "--check")
    assert r.returncode != 0
    assert "zod" in r.stderr and "no credit row" in r.stderr


def test_missing_license_fails(tmp_path):
    dst = make_copy(tmp_path)

    def blank(rows):
        for x in rows:
            if x["name"].lower().startswith("astropy"):
                x["license"] = ""
        return rows

    edit_rows(dst, blank)
    r = run(dst, "--check")
    assert r.returncode != 0
    assert "empty license" in r.stderr


def test_unlisted_ref_file_fails(tmp_path):
    dst = make_copy(tmp_path)
    (dst / "web" / "public" / "ref" / "mystery.json").write_text("{}")
    r = run(dst, "--check")
    assert r.returncode != 0
    assert "mystery.json" in r.stderr


def test_stale_credits_md_fails(tmp_path):
    dst = make_copy(tmp_path)
    with (dst / "CREDITS.md").open("a", encoding="utf-8") as fh:
        fh.write("\nedited by hand\n")
    r = run(dst, "--check")
    assert r.returncode != 0
    assert "stale" in r.stderr
    # the default mode repairs it
    assert run(dst).returncode == 0
    assert run(dst, "--check").returncode == 0


def test_output_is_deterministic_and_has_required_text(tmp_path):
    dst = make_copy(tmp_path)
    text = (dst / "CREDITS.md").read_text(encoding="utf-8")
    assert "GPL-3.0" in text and "LICENSE" in text
    run(dst)
    assert (dst / "CREDITS.md").read_text(encoding="utf-8") == text


def test_missing_paper_row_fails_once_its_file_exists(tmp_path):
    dst = make_copy(tmp_path)
    assert run(dst, "--check").returncode == 0
    shutil.copy(ROOT / "shift_stack.py", dst / "shift_stack.py")
    edit_rows(dst, lambda rows: [x for x in rows if not x["name"].startswith("Heinze")])
    r = run(dst, "--check")
    assert r.returncode != 0
    assert "Heinze" in r.stderr
