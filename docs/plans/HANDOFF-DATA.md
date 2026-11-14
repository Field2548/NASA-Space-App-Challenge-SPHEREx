# DATA agent hand-off (kept current; last update 2026-11-15 04:50 Bangkok)

For whoever continues the DATA plan (`docs/plans/PLAN-1-data-science.md`). Everything you need is in this file and on GitHub; nothing lives only in the old session.

**Why this exists now:** at 04:40 Bangkok the DATA session's sub-agent budget for the opus and sonnet models ran out (resets 09:10 Bangkok; the fable budget resets 06:40). Three sub-agents were cut off mid-task. The orchestrating session still polls, verifies and commits, but new implementation work waits for the reset unless another agent takes items from "Open work" below. If you take one, say so on the board (issue #2) first, so two agents do not write the same file.

## How to take over

1. Read `docs/plans/00-COORDINATION.md`, then `docs/plans/PLAN-1-data-science.md`, then this file.
2. Branch from the tip of `claude/great-galileo-8dyj6n` (the first DATA session could push only there; the plan's name is `web-data`). Say on the board which branch DATA uses now.
3. Post `[DATA] I am @<login>, taking over from the previous DATA session` on issue #2 and start the 15-minute poll (coordination 3.4). `gh` may not work in every harness; the poll is: open issues labelled `to:data`, comments on #3, open PRs, the last comments on #2, and `git log HEAD..origin/web`.
4. Rebuild the local inputs (gitignored, so a fresh machine has none): `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest` (Python 3.13+ works), then `pipeline/dev/rebuild_inputs.sh frames` (about 5 minutes) and `pipeline/dev/rebuild_inputs.sh bands` (about 20 minutes). Needs `irsa.ipac.caltech.edu`. Answer keys and catalog facts also need `ssd.jpl.nasa.gov`, `ssd-api.jpl.nasa.gov`, `simbad.cds.unistra.fr`, `gea.esac.esa.int`. Without network you can still run every test that reads committed files.
5. Check the state yourself before trusting this file:
   - `.venv/bin/python -m pytest pipeline/tests -q` (at 04:46: 90 passed with `test_catalog.py` left out; that file needs all five `web/data/catalog/*.json`, see Open work 1)
   - `cd web && npm ci && npx vitest run && npm run typecheck && npx eslint lib components` (at 04:45: 123 tests passed, typecheck and lint clean)
   - `scripts/credits-check.sh --check` (at 04:31: `credits ok: 33 rows`)

## Standing instructions from the human (Field2548)

- DATA works as an orchestrator: implementation goes to sub-agents (haiku, sonnet, opus) in batches of related files; the main session plans, verifies, commits and talks on GitHub.
- When work is finished, an adversarial sub-agent re-checks everything from the files, not from memory (also coordination section 9).
- Goal: keep refining until no caveats and no todos remain, check our own work, then check GAME's and SERVER's work once, and leave no request from the others unanswered.
- If the budget is nearly gone: write this hand-off and let other agents continue.
- Not yet answered by the human (ask again, do not assume): may DATA merge its own PRs into `web` and approve GAME's PRs as the plan says, and may DATA push to `web-data`? Until a yes: open PRs, review by comment only, let GAME or SERVER merge.

## Merged into `web` (PR #5)

Field schema contract v1, fixture spot, five ready spots at float precision with answer keys and `index.json`, single exposures (`exposures.u16` + `exposures.json`), first credit rows. An independent adversarial review confirmed from the files: rows are top-down and not mirrored (max 1 gray level against the committed previews), the contract's WCS formula matches astropy to 0.0016 px, answer-key positions match a fresh JPL Horizons query to 0.008 px, bot candidates are flipped correctly, noise bars equal the README table, exposure planes and wavelength grids match recomputation, and the exporters are deterministic (byte-identical re-run). Its findings that need work are in "Open work" 3 to 6.

## On the DATA branch, verified, not yet in a PR

| What | Files | Proof |
| --- | --- | --- |
| License and decisions | `LICENSE`, `docs/DECISIONS.md` | byte-identical to Debian's GPL-3 text; section 14 verbatim |
| Wavelength switch + hook | `web/components/WavelengthSwitch.tsx` (+ test) | rebuild matches `frames.u16` on real data (Eros median 0.034 sigma); hook shape is contract issue #8 to GAME |
| Science libraries | `web/lib/spectra.ts`, `web/lib/inspect.ts` (+ tests), `web/public/ref/molecule_bands.json`, `web/public/ref/spt_teff.json` | 40 vitest tests; Eros is measured along its path at S/N 213 to 601; Mamajek table fetched (version 2022.04.16), parsed by script |
| Credits tooling | `scripts/credits-check.{py,sh}`, `pipeline/tests/test_credits.py`, `docs/credits/data-web.csv`, generated `CREDITS.md`, README sections Website / How we used AI / Acknowledgments | checker passes, 8 tests |
| Spectrum tiles for all five spots | `pipeline/spectrum_tiles.py`, `--bands` hook in `pipeline/export_web.py`, `pipeline/tests/test_spectrum.py`, `web/public/fields/<slug>/spectrum/` (3.2 MB per 119 px spot, 0.8 MB per 59 px spot), `data/bands_<slug>/` tables and figures | pytest passes; the sub-agent was cut off before writing its own cross-check report, so the final adversarial pass must cover this |
| Inputs script, this file | `pipeline/dev/rebuild_inputs.sh`, `docs/plans/HANDOFF-DATA.md` | |

The branch history contains commits titled "WIP snapshot": they are checkpoints of files that were still being written. Judge files by the table above and by running the tests, not by those commit titles.

## Open work, in priority order

1. **Catalog facts (cut off).** `pipeline/catalog_facts.py` and `pipeline/tests/test_catalog.py` exist; contract section 9 was updated by the sub-agent; only `web/data/catalog/eros.json` had been written when it stopped. `catalog_facts.py --all` is being re-run by the orchestrator (log: `work/catalog_all.log`). Still to do: confirm all five files exist and `test_catalog.py` passes; verify the open points from the task brief that nobody reported on (bright Gaia stars land on bright pixels; SB-ident position of the tracked object within 2 px of the answer key in every in-grid frame; SIMBAD coordinate epoch; proper-motion maths against astropy; Cygnus Gaia truncation handled by lowering the magnitude limit, not by cutting); add credit rows for SIMBAD, Gaia DR3 and JPL SB Identification with acknowledgment text fetched from the official pages (never from memory).
2. **Quick look (cut off).** Written so far: `web/lib/fits.ts` (+ test), `web/lib/sipwcs.ts` (+ test, with astropy ground truth in `web/lib/testdata/sip_ref.json` and its generator), `web/lib/quicklook.ts` (no test yet). Missing: `web/lib/quicklook.test.ts`, `web/workers/quicklook.ts`, `web/app/api/quicklook/list/route.ts`, `web/components/QuickLook.tsx`, the day-one CORS check on `nasa-irsa-spherex.s3.us-east-1.amazonaws.com` (tell SERVER the result: they build `/api/s3range` only if the browser is blocked), and the check that Range-read pixels equal IRSA's own cutout. The cut-off agent reported none of its measurements, so treat the three existing files as unreviewed. Full brief: build prompt 8.20, section 9 signatures, section 16 checks.
3. **Spoilers in public files (adversarial review, MAJOR).** `field.json` and `index.json` show `"title": "(433) Eros"`, `kind`, and for Cygnus `"kind": "control"`, `"difficulty": "control"`, `"title": "Cygnus control field"`, which gives away "Nothing moved". The build prompt's own schema asks for these fields, and its decision table says names stay locked until Submit. Needs a `contract` issue to GAME and SERVER with an exact before and after (for example: neutral public titles, no public `kind`, Cygnus listed with an ordinary difficulty; real names kept in the answer key and returned by `/api/check`). Not opened yet. The slugs (`eros`, `cygnus`) also spoil; decide in the same issue whether that is accepted.
4. **Exposure encoding (adversarial review, MINOR, contract section 7).** Linear u16 with step up to noise / 2 leaves tails when frames are rebuilt (Eros: 1 percent of sky pixels off by more than 1 sigma). Proposed fix, not started: asinh companding per exposure (`value = round(asinh(x / noise) / step) + 32767`), which keeps both the sky and the 25000 sigma peak of Eros with no clipping. It changes `exposures.json` keys, so it needs a `contract` issue, and three decoders must change together: `read_exposures` in `export_web.py`, `decodeExposures` in `WavelengthSwitch.tsx`, `decodeExposures` in `spectra.ts`. At the same time tighten the rebuild recipe text: all selected planes count for the "3 or more" rule; clip strictly beyond 3 sigma; MAD of 0 means no clipping; 5 iterations (astropy default), not "until nothing more is clipped"; the frame noise uses the median as centre and a population standard deviation; a frame with no exposure passing the filter is skipped; wavelength interpolation clamps to the nearest cell centre at the edges.
5. **Smaller fixes to `pipeline/export_web.py` and its tests (adversarial review).**
   - `export_exposures` rebuilds the grid from a rounded field of view (line near `grid_wcs(..., round(h * 6.15 / 3600, 1))`): wrong for anything but 0.1 and 0.2 degrees. Pass the frame WCS instead (add a keyword argument; do not change the positional signature).
   - Answer-key `positions[].snr` is the 3x3 maximum and can be a background star (Makemake frame 5 reads 21.0, a star; frame 1 reads 1.8, no detection). Add a residual S/N (leave-one-out, as `motion_frames.residuals`) as an additive key and document both.
   - Use SPHEREx as the Horizons observer (`500@-163182`) and mid-exposure times: Eros centroid offsets drop from about 0.45 px to about 0.23 px. Do it in `pipeline/`, never by changing `motion_frames.track_positions`.
   - `--star` is accepted and silently ignored: make it fail with a clear message (star targets are on the cut list).
   - The source order in the plan has a middle step, "re-run `motion_frames.py`", that `export_field` skips (it goes from FITS straight to the PNG fallback).
   - `frames[].utc` rounds to the nearest second while `frames.csv` and `exposures[].utc` truncate (18:04:05 against 18:04:04). Make them agree.
   - `crpix` is a float in real spots and an int in the fixture.
   - The `os.sep + "public"` guard can fire on a path like `/publications/`.
   - PNG fallback: the docstring and the test comment name Cygnus as the worst case; measured, it is Makemake (white point 28 percent low, source S/N 19 percent low; the bias is always low). The picture is exact. Correct the text.
   - Tests: `test_known_object_is_where_jpl_says` only checks its own bounds; add a comparison against a recorded Horizons reply. `test_answer_keys_are_not_public` searches for two key names only. On a clean checkout 10 tests skip because FITS files are gitignored; commit a small sample of FITS pixel values per spot so the round-trip test always runs. Untested: the contract WCS formula, wavelength grids against the spectral WCS, frame metadata against `frames.csv`, determinism.
6. **Requests from SERVER (review of #5).** Add `.gitattributes` with `*.u16 binary` and `*.webp binary`. Vet the bot candidates that are above the bar but are not the known object (Hektor ranks 2 and 3, Eris rank 2): alias of the bright object, catalogued asteroid per SB Identification, or unconfirmed; add a per-candidate status through a `contract` issue. Do not change `above_noise_bar`.
7. **Not started.** `web/lib/overlays.ts` + `web/app/api/overlay` (`mode=round` returns nothing, unit test; publish the `/api/overlay` and `/api/quicklook/list` JSON through a `contract` issue first, as promised on PR #6). `web/components/SpectrumChart.tsx`, `LightCurveBars.tsx` (the libraries they need are done), render tests for all DATA components (none exist; `jsdom` is installed). `docs/DEMO.md`. The `asset-license-audit` skill run. Phase 5 science checks (GAME's Color by time on Eros correlates at least 0.9 with `onion_dark.png`; JPL diamonds within 2 px of the answer key on Eros). Cut-list items only if time: star targets, `build_pool.py`.
8. **Credits loose ends.** The AWS Open Data row has no official citation sentence (registry.opendata.aws is blocked from the DATA machine; IRSA's page has none): a person must paste it. IRSA also asks to cite the canonical papers (Bock et al. 2026, Akeson et al. 2026): no row yet. The repo cites Lupton et al. 1999 but has a link only for the 2004 paper. Mamajek's table header asks users to email the author when the table is used in research: that is a human task.
9. **Then:** open a PR into `web` (paste the pytest line; CI runs the web checks), run the final adversarial pass over all DATA work, review GAME's and SERVER's work once, and answer anything still open on the board.

## Caveats that users of the science libraries must know (reported by the sub-agent that wrote them)

- Cube spectra are in MJy/sr per pixel; path spectra are in mJy. `Spectrum.flux` in `types.ts` says mJy only (request to GAME, who owns that file).
- Eros has 100 bands, not 102: use `bands.length`.
- Each band of a cube spectrum comes from a different image, months apart, so a star shows about 25 percent band-to-band scatter that the per-band `noise` does not include. `findFeatures` inflates errors for this; `matchReferences` does so only with `{ inflateErrors: true }`. Even so, 3.75 percent of Eros-cube pixels show a 3 sigma "feature": the hint must stay worded as "possible".
- The 1.5 px aperture catches about 88 percent of the flux at 1.1 um and about 70 percent at 4.9 um; no aperture correction is applied, so path spectra lean blue.
- The "heat glow" mover reference (300 K, equal to sunlight at 4.5 um) and the match-quality thresholds are choices, not fits. Real movers will usually rate "poor".
- Molecule band widths are chosen where the build prompt gives only a centre; each is flagged `"width": "chosen"` in `molecule_bands.json`.
- No brown-dwarf templates (SPIFF not loaded, issue #3 item 5): `HAS_BROWN_DWARF_TEMPLATES = false`, and the UI must say comparisons use blackbodies only.
- The wavelength switch hook and component are type-checked and their maths is tested, but nothing renders them in a test yet.

## Facts that cost time to learn

- JPL's Small-Body Identification API refuses `mpc-code=500` (the build prompt suggested it). A geocentric observer is `xobs=0,0,0,0,0,0`; verified on the Eros field.
- Eros leaves the 0.2 degree picture after frame 3. Its answer-key positions for frames 4 and 5 have `in_grid: false`. The plan's test "Eros track pixel inside the grid for every frame" cannot hold.
- The images come from SPHEREx Data Release 1 (Eros, Hektor, Makemake, Eris) and Quick Release 3 (Cygnus), not QR2. DOIs read on IRSA pages: 10.26131/IRSA678 (DR1) and 10.26131/IRSA662 (QR3).
- Rebuilt FITS frames reproduce the committed preview PNGs to within one gray level, so the web data and the README figures show the same pixels.
- Committed `frames.csv` files have Windows line endings; strip `\r` before comparing.
- Use `TZ=Asia/Bangkok date` for board posts; never guess the time.
- `scripts/poll.sh` needs `gh` with GraphQL; in the first session only the GitHub MCP tools worked.
- A bare `npx tsc --noEmit` in `web/` fails on a fresh clone until `npx next typegen` has run; `npm run typecheck` does both.
- The S3 bucket host answered a plain GET from the DATA machine, but nobody has yet tested browser-style CORS.
