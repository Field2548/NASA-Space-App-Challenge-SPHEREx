# NASA-Space-App-Challenge-SPHEREx

Python tools that download NASA SPHEREx images from IRSA and turn them into pictures where
**moving objects (asteroids, dwarf planets) are easy to spot**: each moment in time gets its
own colour, so things that stay still look white and things that move leave a coloured trail.

![Eros onion skin](data/motion_13.2004_14.38_2025-07-09/summary.png)
*Asteroid (433) Eros on 9 July 2025: one coloured dot per moment (blue → sky blue → green), inside the circles where JPL says Eros was. Stars that didn't move are white.*

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
```

## Scripts

| Script | What it does | Main outputs |
| --- | --- | --- |
| `download.py` | Cutouts of one sky spot over time, with wavelength, bad-pixel mask and date per frame | `cutout_*.fits/.png`, `index.csv` |
| `spectral_bands.py` | All 102 SPHEREx colour bands (0.75–5 µm) of one spot, lined up and merged | `composite.png`, `bands_grid.png`, `cube.fits` |
| `deglow.py` | Removes the glow around stars; compares 3 methods | `glow_comparison.png`, `composite_tophat.png`, `composite_points.png` |
| `motion_frames.py` | The "onion skin": N moments in time, each tinted a colour and stacked | `summary.png`, `onion_light.png`, `onion_dark.png`, `changes.png`, `blink.gif`, `frames.fits` |
| `shift_stack.py` | Digital tracking: finds movers too faint to see in any single frame | `stack_search.png`, `candidates.csv` |

```bash
python spectral_bands.py 304.6935 42.4437          # 102 bands of one spot (~15 min first time)
python deglow.py data/bands_304.6935_42.4437        # glow removal on that result
python motion_frames.py 304.6935 42.4437           # onion skin of the same spot
python motion_frames.py 13.2004 14.3800 --start 2025-07-09T17:00 --track 433   # Eros demo
python shift_stack.py data/motion_26.3271_-0.4338_2026-01-06 --track 136199    # find Eris blind
python spectral_bands.py 304.6935 42.4437 --redraw  # remake pictures from cube.fits, no network
```

Every script prints its options with `--help`. Downloads are cached, so re-running is fast.

## 102 bands vs. the 8 bands in a frame

SPHEREx splits 0.75–5 µm into **102 bands** (6 detectors × 17). Each detector's filter changes
wavelength across the detector, so one exposure sees a given sky spot in only **2 bands** (one
detector pair: D1+D4, D2+D5 or D3+D6). A **burst** is ~4 exposures 2 minutes apart, so a spot
gets **~8 of the 102 bands per burst**, taken within ~6–8 minutes. Collecting all 102 takes weeks
(the `spectral_bands.py` composite uses exposures from Apr 2025 to Jun 2026).

Bursts of the same spot repeat ~1.6 h (one orbit), ~half a day or a few days apart. In the
examples below, frames are **1.6–39 hours apart**; each frame's label shows the gap (`+21.1 h`).

## How the onion skin works

1. Find every SPHEREx image of the spot and group them into **bursts** (exposures a few minutes apart).
2. Take N bursts in time order. For each, merge its 6–8 bands into one grayscale frame with a
   3σ-clipped mean, which removes cosmic-ray hits (they appear in only one exposure).
3. Tint each moment with a colour-blind-safe colour (Okabe–Ito: blue → sky blue → green →
   orange → vermillion), rescaled so all colours add up to white, and stack them:
   - `onion_light.png`: like an animator's onion skin. Still stars are **black**, movers are **coloured**.
   - `onion_dark.png`: the same on black. Still stars are **white**.
   - `changes.png`: each frame minus the median of the *other* frames (as Backyard Worlds does),
     so only things that changed remain.
   - `onion_noglow.png` / `onion_points.png`: the same with star glow removed (see below).

Why a frame is one burst and not all 102 bands: SPHEREx needs about a month to collect all 102
bands of a spot, but an asteroid crosses the field in hours, so a 102-band merge would erase it.

## Difficulty ladder (real objects, positions checked against JPL Horizons)

| Level | Object | Moves per frame | Signal/noise | Result |
| --- | --- | --- | --- | --- |
| Easy | [(433) Eros](data/motion_13.2004_14.38_2025-07-09/summary.png), near-Earth asteroid | 20–35 px | very bright | 3 big coloured dots |
| Medium | [(624) Hektor](data/motion_184.3049_-6.3773_2025-12-24/summary.png), Jupiter trojan | 7–50 px | 130–230 | 5-colour trail in a crowded star field |
| Hard | [Makemake](data/motion_200.0075_21.523_2025-05-30/summary.png), dwarf planet | 3–5 px | 2–9 | Faint; clearly found in 2 of 5 frames, crosses a star |
| Impossible by eye | [Eris](data/motion_26.3271_-0.4338_2026-01-06/summary.png), dwarf planet | ~1.7 px | 2–4 | Too faint for single bursts, but **found blind by `shift_stack.py`** ([figure](data/motion_26.3271_-0.4338_2026-01-06/stack_search.png)) |
| No movers | [Cygnus field](data/motion_304.6935_42.4437/summary.png) (far from the ecliptic) | – | – | Everything white, as expected |

Difficulty knobs: object brightness, `--min-spacing HOURS` (more time between frames = longer
trail), and how crowded the star field is. `--track NAME` circles the object and prints its
signal/noise in each frame. The exact commands for each example are at the top of `motion_frames.py`.

## Finding what the eye can't: shift-and-stack

`shift_stack.py` tries every plausible motion, shifts the frames back along it and adds them up.
For the right motion a mover lands on one pixel in every frame, so its signal adds up while the
noise doesn't (Heinze et al. 2015, ["digital tracking"](https://arxiv.org/abs/1508.01599);
Whidden et al. 2019, [KBMOD](https://arxiv.org/abs/1901.02492)). Stars are removed first, each
frame's contribution is capped at ±4σ (so one cosmic ray can't fake a find), and the same search
on sign-flipped images gives an honest **noise bar** a real candidate must beat.

| Field | Single-frame S/N | Stacked, found blind | Noise bar | vs JPL |
| --- | --- | --- | --- | --- |
| Eris | 2.2–3.8 | **6.9σ** (#1) | 5.9σ | 0.5 px, same motion |
| Makemake | 2.0–12.1 | **7.9σ** (#1) | 6.4σ | 0.0 px |
| Hektor | 140–250 | #1 (capped) | 6.4σ | 1.5 px |
| Cygnus (no movers) | – | nothing above bar | 8.4σ | correct |

Margins are small (Eris beats the bar by 1σ), and crowded fields have a higher bar.

## What we tried that did NOT help (measured with fake stars injected into real data)

- **PSF matched filter**: textbook optimal for white noise, but on our resampled frames it
  *lowered* fake-star S/N to 0.56–0.81×. Kept as `--matched-filter`, off by default.
- **Random-matrix-theory denoising** (MP-PCA, Gavish–Donoho): erases sources below ~3σ (only
  16–33% kept) while boosting ones above ~4σ; only 8 bands per burst is too few for RMT.
- **Max instead of median/mean to combine bands**: brighter numbers, but keeps every cosmic ray
  (up to 43 fake dots per frame).

## Removing star glow

![Glow comparison](data/bands_304.6935_42.4437/glow_comparison.png)

- **Top-hat filter**: best overall. Removes halos, keeps faint stars and still looks like a photo.
- **Redrawn points**: every star detected and redrawn as a sharp dot. Best for spotting motion,
  but drops anything that isn't a star.
- **Deconvolution (Richardson–Lucy)**: the textbook method, but SPHEREx pixels (6.15″) are about
  as big as a star's image, so it sharpens cores and leaves the halo.

## Display choices (community standards)

- Black point just below the sky (−1σ) and an asinh stretch (Lupton et al. 1999/2004, as in
  SDSS, the Legacy Survey and Backyard Worlds), the same stretch for every frame.
- Colour composite: Lupton colour-preserving asinh (`make_lupton_rgb`), channels PSF-matched and
  white-balanced first, so a star's colour doesn't change with brightness.
- Nearest-neighbour upscaling (smooth upscaling rings around 1–2 px stars).

## Notes

- Downloaded FITS files are not in the repo (`.gitignore`): run the scripts to re-create them.
- IRSA sometimes answers `502`/`503` when busy. The scripts retry automatically; if a run still
  fails, run it again and the finished downloads are reused. `motion_frames.py` saves each
  field's search results (`sia_results.ecsv`), so re-runs don't need IRSA's search at all.
- Use `DATE-OBS` for when a frame was observed. The `DATE` header is when IRSA wrote the file.
- SPHEREx data: [IRSA SPHEREx](https://irsa.ipac.caltech.edu/Missions/spherex.html).
  Based on IRSA's [SPHEREx tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/).

## Website

The `web/` folder holds a public web game built for the 2026 NASA Space Apps Challenge. Players look at real SPHEREx images of the same patch of sky taken at different times and try to spot the objects that moved: asteroids, dwarf planets and nearby stars. It has a short tutorial, image tools, colour-blind modes, a timeline, a sky map and an Inspect pop-up that shows what can honestly be said about a clicked spot. The public URL will be added here at deploy time.

To run it on your own computer:

```bash
cd web && npm ci && npm run dev
```

Then open http://localhost:3000. The sky patches the site shows are made by the Python tools in this repo. To rebuild them (the SPHEREx files must already be downloaded, see the scripts above):

```bash
python pipeline/export_web.py --all        # the five ready spots, as files for the site
python pipeline/catalog_facts.py --all     # names and facts of known objects near each spot
```

## How we used AI

We used Claude Code (Anthropic's coding assistant) to help write the code in this repo.

- The Python tools and the science behind them were written by the team with Claude Code. The repo history shows this: many commit messages carry a `Co-Authored-By: Claude` line.
- The website was built by three Claude Code agent sessions, called DATA, GAME and SERVER. They worked on separate branches and talked to each other only through GitHub issues and pull requests, following the plans in `docs/plans/`.
- People kept the jobs that need a person: accounts, secrets, approvals, and the final submission.
- Every outside idea, dataset, library, font and icon is credited in `CREDITS.md`. Other teams' projects were read for ideas only. The code is our own.
- No AI-generated images or video are used. Every picture on the site is real SPHEREx data, or is drawn in code (CSS and SVG).

## Acknowledgments

This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.

Every dataset, service, library, font and idea we used is listed in [`CREDITS.md`](CREDITS.md) with its author, link and license. This project is licensed under GPL-3.0, see [`LICENSE`](LICENSE).
