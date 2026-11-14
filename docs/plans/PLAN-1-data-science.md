# PLAN 1 - DATA agent (data, science libraries, quick look, credits)

Branch: `web/data`. Read first: `docs/plans/00-COORDINATION.md`, then `docs/BUILD_PROMPT.md` (BP) sections 2, 6, 7, 8.16 (C), 8.17, 8.18, 8.20, 9, 13, 16.
Also read on branch `Film`: `CLAUDE.md`, `README.md`, `motion_frames.py`, `shift_stack.py`, `spectral_bands.py`, `download.py`, and `data/motion_*/`.
Rule: never change a Python function signature; import and reuse.

Your job in one line: turn the repo's processed data into files the web app can load, and own the science code that reads them (spectra, overlays, quick look), plus credits and license.

## Who you depend on, who depends on you

| You need | From | You give | To |
| --- | --- | --- | --- |
| `web/lib/types.ts`, scaffold on `web` | GAME | fixture spot + `docs/contracts/field-schema.md` (within 40 min) | GAME, SERVER |
| API contract for `/api/info` | SERVER | `catalog/<slug>.json`, `answers/<slug>.json` shapes | SERVER |
| laptop FITS runs, `spectral_bands.py` runs | HUMAN | `SpectrumChart`, `spectra.ts`, `inspect.ts` pure fns | SERVER (Inspect shell) |
| Vercel env | HUMAN | `WavelengthSwitch`, `QuickLook` components | GAME mounts them |

## Phase 0 (03:30 - 04:00)

- [ ] `git checkout -b web/data origin/Film` (if `web` exists, branch from it). Create `docs/credits/data.csv`.
- [ ] Publish `docs/contracts/field-schema.md`: field.json (BP 6.2 schema, verbatim), frames.u16 layout, thumbs, `exposures.u16` + `exposures.json`, `spectrum/index.json` + tiles, `answers/<slug>.json`, `catalog/<slug>.json`, `index.json`. Include byte layout and the dequantize formula.
- [ ] Write a synthetic fixture spot `web/public/fields/fixture/` (32x32 px, 4 frames, one dot moving 2 px per frame, 3 static stars) with a matching `web/data/answers/fixture.json`. Script: `pipeline/make_fixture.py`. Push and post on the board.
- [ ] Post the `ask-human` issue: laptop with cached FITS, who starts `spectral_bands.py` runs (BP 6.5), SPIFF pickle approval (BP 6.6), Mamajek table download.

## Phase 1 (04:00 - 08:00): ready spots

- [ ] `pipeline/export_web.py FOLDER --slug S --title T --difficulty D [--track ID | --star NAME] [--bands DIR]` (BP 6.2). Source order: `frames.fits`, re-run `motion_frames.py`, PNG fallback with `"precision": "png8"`.
- [ ] Functions from BP section 9 (Python list): `export_field`, `frames_from_fits`, `frames_from_png`, `answer_key`, `write_u16`, `make_thumbs`. Rows top-down, flip FITS once.
- [ ] Export all 5 spots (eros, hektor, makemake, eris, cygnus) and `index.json`. Answer keys under `web/data/answers/` (never `public/`): known positions per frame, bot candidates with y flipped, noise bars (Eris 5.9, Makemake 6.4, Hektor 6.4, Cygnus 8.4 sigma), `nothing_moves: true` for Cygnus.
- [ ] Tests (pytest): round-trip dequantize within `scale/2`; PNG fallback grid equals the FITS grid within 1 level; Eros track pixel inside the grid for every frame; Cygnus has no candidate above the bar.
- [ ] PR into `web`, tag GAME and SERVER on the board with the commit hash.
- [ ] Credits rows: IRSA, SPHEREx, astropy, astroquery, numpy, JPL Horizons.

## Phase 2 (08:00 - 12:00): exposures and wavelengths

- [ ] `export_exposures(folder, sky, out_dir)`: `exposures.u16` + `exposures.json` (BP 6.2 last bullet). Reuse `clean_band` and `resample`. Hide in PNG-fallback spots.
- [ ] `web/components/WavelengthSwitch.tsx` (BP 8.17): All, Short, Long, Longest, D1 to D6. Rebuild frames in the browser from exposure planes, 3-sigma clipped mean, fewer-than-3 notice, one shared stretch. Export a hook `useWavelengthFrames(field, selection)` that GAME's viewer calls; agree on its shape in a `contract` issue.
- [ ] Start `catalog_facts(ra, dec, fov, mjds, track=None)` (BP 6.5): SIMBAD and Gaia cones moved to each frame date, Horizons r and delta, SB Identification per frame. Output `web/data/catalog/<slug>.json`.
- [ ] Run (or ask HUMAN to run) the five `spectral_bands.py` commands from BP 6.5 early; they take about 15 min each.
- [ ] Credits rows: SIMBAD, Gaia DR3 (copy official acknowledgment text; fetch, never write from memory).

## Phase 3 (12:00 - 16:00): overlays and quick look

- [ ] `export_spectrum_tiles(bands_folder, out_dir, tile=32)` and `spectrum/index.json` (BP 6.5).
- [ ] `lib/overlays.ts` + `app/api/overlay` (BP 8.18). `mode=round` returns nothing (unit test). Ready spots read `catalog/<slug>.json`; quick look calls JPL SB Identification and Gaia live.
- [ ] Quick look steps 1 to 3 (BP 8.20): `app/api/quicklook/list` (IRSA SIA, retries to 45 s, 1-day cache, `cloud_access` key), `lib/fits.ts` (`readHeaders`, `readRows`), `lib/sipwcs.ts` (TAN-SIP, SIP terms applied even without the `-SIP` suffix), `lib/quicklook.ts` (`planQuickLook`, `runQuickLook`), `workers/quicklook.ts`. Skip tile-compressed HDUs.
- [ ] **Day-one CORS check** on `nasa-irsa-spherex.s3.us-east-1.amazonaws.com`. If blocked, tell SERVER (owns `app/api/s3range`, whitelist that bucket only) via issue.
- [ ] Checks: browser TAN-SIP matches astropy within 0.01 px on 3 real files (commit a small fixture); Range-read pixels equal IRSA's cutout for the same file and area.
- [ ] `QuickLook.tsx`: byte budget shown first, ASCII progress bar, clean cancel, at most 4 parallel downloads, label "Quick look: live and unmasked...".

## Phase 4 (16:00 - 19:00): spectrum view and credits

- [ ] Reference data (ask first for the SPIFF pickle): throwaway venv, pinned commit, read the loader, convert to `web/public/ref/spherex_templates.json` + `LICENSE-SPIFF.txt`. Mamajek table to `spt_teff.json`. If not approved: blackbody only, and tell GAME and SERVER so the UI says so.
- [ ] `lib/spectra.ts` (BP section 9): `wavelengthColor`, `spectrumAlongPath`, `matchReferences`, `blackbodyFit`, `temperatureGuess`. `lib/inspect.ts` pure functions: `loadSpectrumAt`, `colorHint`, `findFeatures`, `lightCurveAt`, `parallaxDistance`, `redshiftDistance`, `eclipticLatitude`, `toPlainType`. Molecule band ranges in one config file with a source comment.
- [ ] `SpectrumChart.tsx` and `LightCurveBars.tsx` (BP 8.16 C). Gray dots in `mono` vision. Always-visible caveat line. SERVER mounts them inside the Inspect popup.
- [ ] Quick look step 4 data side: expose the track so SERVER's check route can call `sb_ident`.
- [ ] `scripts/credits-check.*`: fails if any npm production dependency, API in BP 7, file in `public/ref/`, or idea-table project lacks a row. Merge `docs/credits/*.csv` into `CREDITS.md`. Include the borrowed-ideas table from BP 13 and the sentence "We read these projects for ideas; all code here is our own."
- [ ] `LICENSE` (GPL-3.0), `docs/DECISIONS.md` (BP section 14 table), README "Website", "How we used AI", "Acknowledgments" sections (SERVER links them from `/about`).
- [ ] Optional if time: star targets (`pipeline/run_star_targets.ps1` and `.sh`, BP 6.3), `build_pool.py` (BP 6.4). Both are on the cut list.

## Phase 5 (19:00 - 21:00)

- [ ] Run all pytest and vitest for your files. Run the `asset-license-audit` skill with `aladin-lite` as an approved GPL exception. Zero blockers.
- [ ] `docs/DEMO.md`: 30-second script with English subtitles (check 2026 submission guide).
- [ ] Science checks: GAME's Color by time on Eros correlates at least 0.9 with `onion_dark.png`; JPL diamonds within 2 px of answer key for Eros on every frame.

## Your tests (vitest or pytest)

`parallaxDistance(500,100)` gives 2 pc, 6.52 ly, and null if ratio under 5 | `redshiftDistance(0.01)` about 0.14 Gly | `findFeatures` empty on flat noise | `wavelengthColor` monotonic, gray in mono | `matchReferences` returns the same type as "good" for a template, null under S/N 5 | `blackbodyFit` 3000 K within 10 percent, lower limit at 8000 K | `temperatureGuess` null for movers | `spectrumAlongPath` one point per covering exposure on Eros | `planQuickLook` under budget and respects detector filter | `/api/overlay?mode=round` empty.

## Done when

Five spots load in the app, overlays and quick look work on Eros and WISE 0855 coordinates, spectrum view works for spots with cubes, credits check passes, license audit has zero blockers, and your status is posted on the board.
