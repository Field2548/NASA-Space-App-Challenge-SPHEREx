#!/usr/bin/env python3
"""Merge docs/credits/*.csv into CREDITS.md and check that nothing is missing.

Usage:
    scripts/credits-check.py            validate, then (re)write CREDITS.md
    scripts/credits-check.py --check    validate and compare, never write (CI mode)
    scripts/credits-check.py --root DIR run against another checkout (used by the tests)

Nobody edits CREDITS.md by hand. Every agent appends rows to docs/credits/<agent>.csv
(columns: name, author, link, license, used_for, date_checked) and this script merges them
(docs/plans/00-COORDINATION.md section 2). Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

COLUMNS = ["name", "author", "link", "license", "used_for", "date_checked"]
REQUIRED_NONEMPTY = ["name", "link", "license", "used_for", "date_checked"]

# Services, datasets and software that docs/BUILD_PROMPT.md section 7 ("Real APIs and
# services") and section 13 name. Each entry: (label, regex that must match a credit row
# name, condition). A condition says when the credit is required:
#   ("always",)                      the pipeline uses it already
#   ("path", "web/...")              required once that file or folder exists
#   ("grep", [dirs], "regex")        required once source files in those dirs mention it
# Features that do not exist yet are therefore not demanded yet.
REQUIRED = [
    ("SPHEREx data products", r"spherex.*(data|images?)", ("always",)),
    ("NASA/IPAC Infrared Science Archive (SIA, cutouts, TAP)", r"\birsa\b", ("always",)),
    ("JPL Horizons", r"horizons", ("always",)),
    ("Astropy", r"^astropy", ("always",)),
    ("astroquery", r"^astroquery", ("always",)),
    ("photutils", r"^photutils", ("always",)),
    ("NumPy", r"^numpy", ("always",)),
    ("SciPy", r"^scipy", ("always",)),
    ("Aladin Lite v3", r"aladin lite", ("path", "web/components/SkyMap.tsx")),
    ("SPHEREx HiPS (CDS/P/SPHEREx/QR2)", r"hips", ("path", "web/components/SkyMap.tsx")),
    ("CDS Sesame", r"sesame", ("path", "web/app/api/resolve")),
    ("SIMBAD", r"simbad", ("grep", ["web/app", "web/lib", "web/workers"], r"simbad\.cds\.unistra\.fr/simbad/sim|sim-tap")),
    ("Gaia DR3 (ESA Gaia archive)", r"gaia",
     ("grep", ["web/app", "web/lib", "web/workers"], r"gea\.esac\.esa\.int|gaiadr3")),
    ("JPL Small-Body Identification API", r"small-body identification|sb_ident",
     ("grep", ["web/app", "web/lib", "web/workers"], r"sb_ident")),
    ("Gaia DR3 (pipeline/catalog_facts.py)", r"gaia", ("path", "pipeline/catalog_facts.py")),
    ("SIMBAD (pipeline/catalog_facts.py)", r"simbad", ("path", "pipeline/catalog_facts.py")),
    ("JPL Small-Body Identification API (pipeline/catalog_facts.py)", r"small-body identification|sb_ident",
     ("path", "pipeline/catalog_facts.py")),
    ("AWS Open Data / IRSA cloud (nasa-irsa-spherex bucket)", r"aws|nasa-irsa-spherex",
     ("grep", ["web/app", "web/lib", "web/workers"], r"nasa-irsa-spherex")),
    ("Supabase", r"^supabase",
     ("grep", ["web/app", "web/lib"], r"supabase")),
    ("Vercel", r"^vercel", ("path", "vercel.json")),
    ("SPIFF templates", r"spiff", ("path", "web/public/ref/spherex_templates.json")),
    ("Mamajek dwarf colour / Teff table", r"mamajek", ("path", "web/public/ref/spt_teff.json")),
    # Papers and methods named in build prompt section 13, required once the file using them exists.
    ("Heinze et al. 2015 (digital tracking)", r"heinze", ("path", "shift_stack.py")),
    ("Whidden et al. 2019 (KBMOD)", r"whidden", ("path", "shift_stack.py")),
    ("Lupton et al. asinh stretch", r"lupton", ("path", "motion_frames.py")),
    ("Okabe & Ito palette", r"okabe", ("path", "motion_frames.py")),
    ("Orbitron font", r"orbitron", ("grep", ["web/app"], r"Orbitron")),
    ("JetBrains Mono font", r"jetbrains mono", ("grep", ["web/app"], r"JetBrains_Mono")),
]

# npm package name -> text its credit row name starts with, when that differs from the
# package name (case-insensitive; trailing versions are ignored).
DEP_ALIASES = {
    "next": ["next.js"],
    "react-dom": ["react", "react-dom"],
    "aladin-lite": ["aladin lite"],
}

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"}
SKIP_DIRS = {"node_modules", ".next", "dist", "build", ".git", "fields", "data"}

GROUPS = [
    ("data", "Data and services"),
    ("lib", "Software and libraries"),
    ("font", "Fonts and icons"),
    ("music", "Music"),
    ("paper", "Papers and methods"),
]
GROUP_INTRO = {
    "data": "Where the images, catalogues and positions come from, and the services the site runs on.",
    "lib": "The code the site and the processing scripts are built on, including the tools used for testing.",
    "font": "Typefaces and icons shown on the site.",
    "music": "Background music, free to use.",
    "paper": "Published papers and methods we borrowed ideas from. No code or data was copied from them.",
}
SERVICE_WORDS = re.compile(
    r"service|public nasa|public data|acknowledg|odbl|citation|credit|data products|"
    r"\bhips\b|no licen[cs]e stated|database|archive|catalog|\btable\b|\bapi\b|terms of service|no license stated|reference data",
    re.I,
)
FONT_WORDS = re.compile(r"orbitron|jetbrains|lucide|\bfont|\bicon", re.I)


# ----------------------------------------------------------------------------- reading

def norm_key(name: str) -> str:
    """Lower case, no trailing version (`zod 4.6.7`, `Aladin Lite v3`), single spaces."""
    n = re.sub(r"\s+", " ", name.strip().lower())
    n = re.sub(r"(\s+(v\d+(\.\d+)*|\d+(\.\d+)+)(-[\w.]+)?)+$", "", n)
    return n


def read_rows(root: Path, problems: list[str]):
    """Return (rows, files). A row is a dict with COLUMNS plus `_src`."""
    rows, files = [], []
    credits_dir = root / "docs" / "credits"
    for path in sorted(credits_dir.glob("*.csv")):
        rel = path.relative_to(root).as_posix()
        files.append(rel)
        with path.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            header = [h.strip() for h in (reader.fieldnames or [])]
            if sorted(header) != sorted(COLUMNS):
                problems.append(
                    f"{rel}: columns must be exactly {', '.join(COLUMNS)} (found: "
                    f"{', '.join(header) or 'none'})"
                )
                continue
            for i, raw in enumerate(reader, start=2):
                if None in raw:
                    problems.append(f"{rel}:{i}: too many fields in this row (unquoted comma?)")
                    continue
                row = {k.strip(): (v or "").strip() for k, v in raw.items()}
                if not any(row.values()):
                    continue
                where = f"{rel}:{i} ({row.get('name') or 'no name'})"
                for col in REQUIRED_NONEMPTY:
                    if not row[col]:
                        problems.append(f"{where}: empty {col}")
                if row["date_checked"] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["date_checked"]):
                    problems.append(f"{where}: date_checked must look like 2026-11-15")
                row["_src"] = rel
                rows.append(row)
    if not files:
        problems.append("docs/credits/ has no CSV files")
    return rows, files


def merge(rows):
    """Same name (ignoring version) in several files becomes one row, uses joined."""
    merged: dict[str, dict] = {}
    for row in rows:
        if not row["name"]:
            continue
        key = norm_key(row["name"])
        if key not in merged:
            merged[key] = {c: row[c] for c in COLUMNS}
            merged[key]["_key"] = key
            continue
        m = merged[key]
        for col in ("author", "link", "license", "used_for"):
            parts = [p.strip() for p in m[col].split(" || ")]
            if row[col] and row[col] not in parts:
                m[col] += " || " + row[col]
        m["date_checked"] = max(m["date_checked"], row["date_checked"])
    out = []
    for m in merged.values():
        for col in ("author", "link", "license", "used_for"):
            sep = " " if col == "link" else "; "
            m[col] = sep.join(m[col].split(" || "))
        out.append(m)
    return sorted(out, key=lambda r: (r["name"].lower(), r["name"]))


def classify(row) -> str:
    key = row["_key"]
    if row["license"].lower().startswith("published"):
        return "paper"
    if "pixabay" in row["name"].lower():
        return "music"
    if FONT_WORDS.search(row["name"]):
        return "font"
    if SERVICE_WORDS.search(row["license"] + " " + row["name"]):
        return "data"
    return "lib"


def acknowledgments(rows):
    """Quoted acknowledgment sentences, exactly as written in the license column."""
    found = []
    for r in rows:
        for sentence in re.findall(r'"([^"]{40,})"', r["license"]):
            if sentence not in [s for _, s in found]:
                found.append((r["name"], sentence))
    return found


# ----------------------------------------------------------------------------- checks

def source_mentions(root: Path, dirs, pattern) -> bool:
    rx = re.compile(pattern, re.I)
    for d in dirs:
        base = root / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.suffix not in SOURCE_SUFFIXES:
                continue
            if any(part in SKIP_DIRS for part in p.relative_to(base).parts[:-1]):
                continue
            try:
                if rx.search(p.read_text(encoding="utf-8", errors="ignore")):
                    return True
            except OSError:
                continue
    return False


def required_now(root: Path, cond) -> bool:
    kind = cond[0]
    if kind == "always":
        return True
    if kind == "path":
        return (root / cond[1]).exists()
    if kind == "grep":
        return source_mentions(root, cond[1], cond[2])
    raise ValueError(cond)


def name_has(rows, regex) -> bool:
    rx = re.compile(regex, re.I)
    return any(rx.search(r["name"]) for r in rows)


def production_dependencies(root: Path, problems):
    pkg = root / "web" / "package.json"
    if not pkg.is_file():
        problems.append("web/package.json is missing")
        return []
    try:
        return sorted(json.loads(pkg.read_text(encoding="utf-8")).get("dependencies", {}))
    except ValueError as e:
        problems.append(f"web/package.json is not valid JSON: {e}")
        return []


def dep_has_row(dep: str, rows) -> bool:
    wanted = {dep.lower(), *DEP_ALIASES.get(dep, [])}
    return any(r["_key"] in wanted or r["_key"].split(" ")[0] in wanted for r in rows)


def run_checks(root: Path, rows, problems):
    deps = production_dependencies(root, problems)
    for dep in deps:
        if not dep_has_row(dep, rows):
            problems.append(f"production dependency {dep}: no credit row (add one to docs/credits/<agent>.csv)")

    services = 0
    for label, regex, cond in REQUIRED:
        if required_now(root, cond):
            services += 1
            if not name_has(rows, regex):
                problems.append(
                    f"{label}: no credit row, but the code base uses it (BUILD_PROMPT section 7/13)"
                )

    ref = root / "web" / "public" / "ref"
    if ref.is_dir():
        for f in sorted(p for p in ref.rglob("*") if p.is_file() and not p.name.startswith(".")):
            rel = f.relative_to(root).as_posix()
            hay = [" ".join((r["name"], r["link"], r["license"], r["used_for"])) for r in rows]
            if not any(rel in h or f.name in h for h in hay):
                problems.append(f"{rel}: no credit row mentions this file (put the path in used_for)")

    for r in rows:
        if not r["license"].strip():
            problems.append(f"{r['name']}: no license")

    if not (root / "LICENSE").is_file():
        problems.append("LICENSE (GPL-3.0) is missing at the repo root")
    return deps, services


# ----------------------------------------------------------------------------- output

def cell(text: str) -> str:
    return re.sub(r"\s+", " ", text).replace("|", "\\|").strip()


def table(rows) -> list[str]:
    shown = [c for c in COLUMNS if c != "date_checked"]  # the date stays in the CSV for audits only
    lines = ["| Name | Author | Link | Licence | Used for |", "| --- | --- | --- | --- | --- |"]
    for r in rows:
        lines.append("| " + " | ".join(cell(r[c]) for c in shown) + " |")
    return lines


def render(rows) -> str:
    groups = {g: [] for g, _ in GROUPS}
    for r in rows:
        groups[classify(r)].append(r)
    out = [
        "# Credits",
        "",
        "<!-- Generated by scripts/credits-check.py from docs/credits/*.csv. Do not edit by hand. -->",
        "",
        "Onion Sky is built on public data, free software and other people's published work. "
        "This page lists each source, who made it and the terms we use it under. "
        "Much of the code was written with the help of Claude Code, an AI coding assistant made by Anthropic.",
        "",
        "## Acknowledgments",
        "",
        "These are the sentences the data providers ask us to print.",
        "",
    ]
    acks = acknowledgments(rows)
    if acks:
        for name, sentence in acks:
            out += [f"**{cell(name)}**", "", f"> {sentence}", ""]
    else:
        out += ["None found in the credit files.", ""]
    for gid, title in GROUPS:
        out += [f"## {title}", "", GROUP_INTRO[gid], ""]
        if groups[gid]:
            out += table(groups[gid]) + [""]
        else:
            out += ["No rows yet.", ""]
    out += [
        "",
        "## Our license",
        "",
        "Onion Sky is licensed under GPL-3.0. See [`LICENSE`](LICENSE).",
        "",
    ]
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="validate and compare only; never write CREDITS.md")
    ap.add_argument("--root", default=None, help="repo root (default: the folder above scripts/)")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parent.parent

    problems: list[str] = []
    raw_rows, _ = read_rows(root, problems)
    rows = merge(raw_rows)
    deps, _ = run_checks(root, rows, problems)

    text = render(rows)
    target = root / "CREDITS.md"
    if args.check:
        current = target.read_text(encoding="utf-8") if target.is_file() else None
        if current is None:
            problems.append("CREDITS.md is missing; run scripts/credits-check.sh to generate it")
        elif current != text:
            problems.append("CREDITS.md is stale (differs from the credit files); run scripts/credits-check.sh")

    if problems:
        print(f"credits check failed, {len(problems)} problem(s):", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    if not args.check:
        target.write_text(text, encoding="utf-8")

    for r in rows:
        if "not verified" in r["license"].lower():
            print(f"warning: {r['name']}: {r['license']}", file=sys.stderr)
    n_services = len([r for r in rows if classify(r) == "data"])
    print(
        f"credits ok: {len(rows)} rows, {len(deps)} production dependencies, "
        f"{n_services} services"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
