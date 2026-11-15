# CLAUDE.md

Guidance for Claude Code sessions working in this repo. The README is the user-facing doc
(results, figures, method write-ups); read it for the science. This file covers how the code
fits together and what to watch out for.

## Project

NASA Space Apps Challenge 2026, "Planet X and SPHEREx" challenge. Python scripts download
SPHEREx near-infrared images (0.75–5 µm, 102 bands, 6.15″ pixels) from NASA IRSA and turn them
into pictures and searches that reveal **moving solar-system objects**, working up from fast
asteroids to the slow, faint movers a distant "Planet X" would be.

Key physics that drives design decisions:

- Apparent motion is mostly parallax from Earth's orbit. At opposition, rate ≈
  148″/hr × (1 − 1/√r) / Δ (r = Sun distance, Δ = Earth distance, AU). Main belt ~35″/hr,
  Neptune ~4″/hr, Eris (~96 AU) ~1.7 px between frames, Planet X (400–800 AU) ~0.2–0.35″/hr,
  i.e. ~1 px/day. Planets and asteroids move the same way; only rate (→ distance) differs.
- A "frame" = one **burst** (~4 exposures, 2 min apart, ~8 of 102 bands). Never merge all 102
  bands for motion work: collecting them takes weeks and erases movers.
- Bursts of a spot repeat ~1.6 h / ~0.5 d / a few days apart. Slow movers need long baselines
  (`--min-spacing`) and shift-and-stack, since they are below single-frame S/N.

## Scripts and how they depend on each other

Plain top-level scripts (no package, no `src/`), each with `argparse` and a `main()`.
Some import helpers from each other, so **changing a function signature can break another script**:

```text
download.py         search_images, cutout_url            (IRSA SIA search + cutout URLs)
  └─ spectral_bands.py  fetch, unique_images, clean_band, resample, grid_wcs
       └─ motion_frames.py  (also imports deglow)        onion skin, residuals, time_colors, ...
            └─ shift_stack.py  matched_filter, onion_dark, residuals, time_colors, to_png
deglow.py           standalone; also imported by motion_frames.py
```

| Script | Input | Output folder |
| --- | --- | --- |
| `download.py RA DEC` | sky position | `data/` (cutouts + `index.csv`) |
| `spectral_bands.py RA DEC` | sky position | `data/bands_<RA>_<DEC>/` (`cube.fits`, `composite.png`, ...) |
| `deglow.py FOLDER` | a `bands_*` folder | same folder |
| `motion_frames.py RA DEC [--start --track --min-spacing --fov]` | sky position | `data/motion_<RA>_<DEC>[_<date>]/` (`frames.fits`, `summary.png`, `blink.gif`, ...) |
| `shift_stack.py FOLDER [--track]` | a `motion_*` folder (needs `frames.fits`) | same folder (`stack_search.png`, `candidates.csv`) |

Each script's module docstring has full usage and the exact reproduction commands for the
demo fields (Eros 433, Hektor 624, Makemake 136472, Eris 136199, Cygnus control field).
`--track NAME` queries JPL Horizons to circle a known object and report its S/N.

## Running

Windows machine; use the project venv (Python 3.14):

```powershell
.venv\Scripts\python.exe motion_frames.py 26.3271 -0.4338 --start 2026-01-06T00:47 --min-spacing 20 --fov 0.1 --track 136199
.venv\Scripts\python.exe shift_stack.py data/motion_26.3271_-0.4338_2026-01-06 --track 136199
.venv\Scripts\python.exe spectral_bands.py 304.6935 42.4437 --redraw   # no network
```

- Scripts hit the network (IRSA, JPL Horizons). First runs can take minutes (102-band run ~15 min).
- Everything is cached: cutouts, `scan.csv`, `sia_results.ecsv`. Re-runs mostly just redraw.
  `shift_stack.py` and `--redraw` work offline from saved FITS.
- There is no test suite. Verify changes by re-running the demo fields and checking that known
  objects are still recovered (e.g. Eris found blind by `shift_stack.py` at ~6.9σ vs a ~5.9σ
  noise bar; the Cygnus field must produce no candidates above the bar).

## Data and git

- `*.fits`, `data/**/cutouts/`, `data/**/images/` are gitignored (re-downloadable, large).
- PNG/GIF/CSV results in `data/` **are committed** because the README links to them. Re-running a
  demo rewrites them, so expect many modified binaries in `git status`; that is normal.
- `sia_results.ecsv` files are caches; commit or not, they speed up re-runs.

## Gotchas

- IRSA often returns 502/503. Retries are built in (`fetch`, `open_with_retries`); if a run still
  fails, just run it again.
- Use the `DATE-OBS` header for observation time. `DATE` is when IRSA wrote the file.
- Wavelength per pixel comes from the spectral WCS (`WCS(header, key="W")`), not a header keyword.
- `motion_frames.py --start` must be a few minutes **before** the first wanted burst.
- SPHEREx pixels (6.15″) are about the size of a star's image, so deconvolution barely helps.
- Tried and rejected (measured with injected fake stars): the PSF matched filter (lowers S/N on
  resampled frames; behind `--matched-filter`, off by default), RMT/PCA denoising (erases faint
  sources) and max-combining bands (keeps cosmic rays). Don't reintroduce them as defaults.
- `download.py`'s docstring still calls it `download_spherex.py`; the real file is `download.py`.

## Conventions

- Visual standards follow the astro community: asinh stretch with the black point at −1σ, the
  same stretch for every frame, Lupton RGB, Okabe–Ito colour-blind-safe time colours,
  nearest-neighbour upscaling. Keep new figures consistent with these.
- Detection claims must come with a noise bar (sign-flipped search) and, for known objects, a
  JPL Horizons position check. The README reports honest margins, including weak ones.
- The README is written in plain language for a non-specialist audience (challenge judges).
  Keep that tone when updating it, and update its tables when results change.

## Website (planned: Vercel) and project skills

A public website showing these results will be deployed on Vercel. Project skills live in
`.claude/skills/` (installed with `npx skills add ... -a claude-code`, pinned in `skills-lock.json`):

| Skill | Source | Use for |
| --- | --- | --- |
| `frontend-design` | anthropics/skills | distinctive, non-generic UI design |
| `webapp-testing` | anthropics/skills | Playwright end-to-end checks of the running site |
| `vercel-react-best-practices`, `vercel-composition-patterns` | vercel-labs/agent-skills | React / Next.js code |
| `web-design-guidelines` | vercel-labs/agent-skills | UI/accessibility review (fetches rules from Vercel's GitHub) |
| `deploy-to-vercel` | vercel-labs/agent-skills | deploys; preview by default, production only when asked |
| `supabase`, `supabase-postgres-best-practices` | supabase/agent-skills | database, auth, storage, row-level security |
| `asset-license-audit` | ours | copyright/licence check of fonts, sounds, images, data, packages; maintains `CREDITS.md` |

Run `asset-license-audit` whenever an asset or dependency is added and before every production
deploy. Never use NASA logos/insignia on the site. Credit SPHEREx/IRSA data.

## Ideas not yet built

- Rate classifier: convert each candidate's px/day to an estimated distance with the formula
  above, and flag slow movers (< ~1″/hr) along the ecliptic as Planet X candidates.
- Mask known planets and bright asteroids via ephemerides and cross-match the Minor Planet Center.
- Longer-baseline stacks (days to months) for ~1 px/day motion.
