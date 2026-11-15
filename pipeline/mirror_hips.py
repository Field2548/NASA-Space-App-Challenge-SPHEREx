"""Copy the coarse levels of the CDS SPHEREx colour HiPS into the website.

The sky map (web/components/SkyMap.tsx) draws CDS/P/SPHEREx/QR2/color from CDS. When CDS is down
the map has no sky at all. This script copies orders 0..MAX_ORDER (12 * 4**k tiles per order, about
1,000 PNGs for orders 0-3) plus the Allsky preview into web/public/hips/spherex-color/, and writes a
properties file capped at MAX_ORDER, so Aladin Lite never asks the local copy for finer tiles.

Usage:
    python pipeline/mirror_hips.py            # skips tiles already present
    python pipeline/mirror_hips.py --check    # only report whether a CDS mirror answers

The HiPS is ODbL (CDS, built from SPHEREx QR2 data, IRSA); it is credited on /credits.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MIRRORS = ["https://alasky.cds.unistra.fr/SPHEREx/color", "https://alaskybis.cds.unistra.fr/SPHEREx/color"]
MAX_ORDER = 3
OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "hips" / "spherex-color"
UA = {"User-Agent": "onion-sky-hips-mirror/1.0"}

log = logging.getLogger("mirror_hips")


def get(url: str, timeout: float = 20) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def working_mirror() -> tuple[str, str] | None:
    for base in MIRRORS:
        try:
            text = get(f"{base}/properties", timeout=10).decode()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log.info("%s: %s", base, e)
            continue
        if re.search(r"hips_(tile_format|order)", text):
            return base, text
        log.info("%s: answered, but not a HiPS properties file", base)
    return None


def tile_path(order: int, npix: int, ext: str) -> str:
    return f"Norder{order}/Dir{(npix // 10000) * 10000}/Npix{npix}.{ext}"


def capped_properties(text: str) -> str:
    lines = [ln for ln in text.splitlines() if not re.match(r"\s*hips_order\s*=", ln)]
    lines.append(f"hips_order = {MAX_ORDER}")
    return "\n".join(lines) + "\n"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="only report whether a mirror answers")
    args = ap.parse_args()

    found = working_mirror()
    if not found:
        log.error("no CDS mirror serves the SPHEREx HiPS right now; try again later")
        return 1
    base, props = found
    log.info("mirror %s answers", base)
    if args.check:
        return 0
    ext = "png"
    m = re.search(r"hips_tile_format\s*=\s*(\S+)", props)
    if m and "png" not in m.group(1):
        ext = m.group(1).split()[0]

    jobs = [tile_path(k, n, ext) for k in range(MAX_ORDER + 1) for n in range(12 * 4**k)]
    jobs.append(f"Norder3/Allsky.{ext}")
    todo = [j for j in jobs if not (OUT / j).exists()]
    log.info("%d files, %d to fetch", len(jobs), len(todo))

    def fetch(rel: str) -> str | None:
        try:
            data = get(f"{base}/{rel}")
        except urllib.error.HTTPError as e:
            return None if e.code == 404 else f"{rel}: HTTP {e.code}"  # 404: tile outside the survey
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            return f"{rel}: {e}"
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        errors = [e for e in pool.map(fetch, todo) if e]
    for e in errors[:10]:
        log.error(e)
    if errors:
        log.error("%d files failed; rerun to retry them", len(errors))
        return 1
    (OUT / "properties").write_text(capped_properties(props))
    log.info("done: %s", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
