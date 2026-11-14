# DATA agent hand-off (kept current; last update 2026-11-15 05:46 Bangkok)

For whoever continues the DATA plan (`docs/plans/PLAN-1-data-science.md`). Everything you need is in this file and on GitHub; nothing lives only in the old session.

**Why this exists now:** at 04:40 Bangkok the DATA session's sub-agent budget for the opus and sonnet models ran out (resets 09:10 Bangkok; the fable budget resets 06:40). Three sub-agents were cut off mid-task. The orchestrating session still polls, verifies and commits, and gives small, exactly specified fixes to the haiku model, which still works; larger items wait for the reset unless another agent takes them from "Open work" below. If you take one, say so on the board (issue #2) first, so two agents do not write the same file.

## How to take over

1. Read `docs/plans/00-COORDINATION.md`, then `docs/plans/PLAN-1-data-science.md`, then this file.
2. Branch from the tip of `claude/great-galileo-8dyj6n` (the first DATA session could push only there; the plan's name is `web-data`). Say on the board which branch DATA uses now.
3. Post `[DATA] I am @<login>, taking over from the previous DATA session` on issue #2 and start the 15-minute poll (coordination 3.4). `gh` may not work in every harness; the poll is: open issues labelled `to:data`, comments on #3, open PRs, the last comments on #2, and `git log HEAD..origin/web`.
4. Rebuild the local inputs (gitignored, so a fresh machine has none): `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest` (Python 3.13+ works), then `pipeline/dev/rebuild_inputs.sh frames` (about 5 minutes) and `pipeline/dev/rebuild_inputs.sh bands` (about 20 minutes). Needs `irsa.ipac.caltech.edu`. Answer keys and catalog facts also need `ssd.jpl.nasa.gov`, `ssd-api.jpl.nasa.gov`, `simbad.cds.unistra.fr`, `gea.esac.esa.int`. Without network you can still run every test that reads committed files.
5. Check the state yourself before trusting this file:
   - `.venv/bin/python -m pytest pipeline/tests -q` (at 05:45: 171 passed)
   - `cd web && npm ci && npx vitest run && npm run typecheck && npm run lint` (at 05:43: 123 tests passed, typecheck and lint clean)
   - `scripts/credits-check.sh --check` (at 05:45: `credits ok: 36 rows`)

## Standing instructions from the human (Field2548)

- DATA works as an orchestrator: implementation goes to sub-agents (haiku, sonnet, opus) in batches of related files; the main session plans, verifies, commits and talks on GitHub.
- When work is finished, an adversarial sub-agent re-checks everything from the files, not from memory (also coordination section 9).
- Goal: keep refining until no caveats and no todos remain, check our own work, then check GAME's and SERVER's work once, and leave no request from the others unanswered.
- If the budget is nearly gone: write this hand-off and let other agents continue.
- Not yet answered by the human (ask again, do not assume): may DATA merge its own PRs into `web` and approve GAME's PRs as the plan says, and may DATA push to `web-data`? Until a yes: open PRs, review by comment only, let GAME or SERVER merge.

## Merged into `web` (PR #5)

Field schema contract v1, fixture spot, five ready spots at float precision with answer keys and `index.json`, single exposures (`exposures.u16` + `exposures.json`), first credit rows. An independent adversarial review confirmed from the files: rows are top-down and not mirrored (max 1 gray level against the committed previews), the contract's WCS formula matches astropy to 0.0016 px, answer-key positions match a fresh JPL Horizons query to 0.008 px, bot candidates are flipped correctly, noise bars equal the README table, exposure planes and wavelength grids match recomputation, and the exporters are deterministic (byte-identical re-run). Its findings that need work are in "Open work" 3 to 6.

## In PR #11 (open into `web`, CI green, waiting for SERVER's review; head 2026-11-15 05:46)

Everything below is verified by the orchestrator's own test runs: `pytest pipeline/tests` 171 passed, `vitest` 123 passed, lint, typecheck and build clean, `credits ok: 36 rows`.

| What | Files | Proof |
| --- | --- | --- |
| Neutral public titles (issue #10, option A), contract version 1.1 | exporter, five `field.json`, `index.json`, `reveal` block in answer keys, `docs/DECISIONS.md` | a test fails if a public file names an object or says `control` |
| Catalog facts for all five spots | `pipeline/catalog_facts.py`, `web/data/catalog/*.json`, contract section 9 | tracked object's JPL-identified position within 0.02 px of the answer key on all four spots; no SIMBAD rows (CDS down) |
| Bot candidate status (`known`, `alias`, `unconfirmed`) | `candidate_status` in `export_web.py`, answer keys, contract section 6 | Eris rank 2 is an alias of Eris (frame 5); Hektor ranks 2 and 3 match no known or catalogued body |
| `change_snr` in answer keys | `answer_key` in `export_web.py` | stars cancel; Makemake frame 5 reads 10.6 instead of 21.0 |
| Spectrum tiles for all five spots | `pipeline/spectrum_tiles.py`, `web/public/fields/<slug>/spectrum/` | pytest; the sub-agent was cut off before its own cross-check, so the final adversarial pass must cover this |
| Wavelength switch + hook | `web/components/WavelengthSwitch.tsx` (+ test) | rebuild matches `frames.u16` on real data; issue #8 stands |
| Science libraries | `web/lib/spectra.ts`, `web/lib/inspect.ts` (+ tests), `web/public/ref/*.json` | 40 vitest tests |
| Credits tooling | `scripts/credits-check.{py,sh}`, `CREDITS.md`, `docs/credits/data-web.csv`, README sections | checker and its 8 tests pass; Gaia acknowledgment fetched from the ESA archive |
| Review fixes | exposure grid for any size, time strings, `--star`, public-path guard, fixture `crpix`, `.gitattributes`, stronger tests (contract WCS formula, FITS pixel sample, frame metadata, public-leak keys) | pytest |
| License, decisions, inputs script, this file | `LICENSE`, `docs/DECISIONS.md`, `pipeline/dev/rebuild_inputs.sh` | |

The branch history contains commits titled "WIP snapshot": checkpoints of files that were still being written. Judge files by the table above and by running the tests.

## Open work, in priority order

1. **Quick look (cut off, unreviewed).** Written: `web/lib/fits.ts` (+ test), `web/lib/sipwcs.ts` (+ test, astropy ground truth in `web/lib/testdata/sip_ref.json`), `web/lib/quicklook.ts` (no test). Missing: `web/lib/quicklook.test.ts`, `web/workers/quicklook.ts`, `web/app/api/quicklook/list/route.ts`, `web/components/QuickLook.tsx`, the day-one CORS check on `nasa-irsa-spherex.s3.us-east-1.amazonaws.com` (tell SERVER the result: they build `/api/s3range` only if the browser is blocked), and the check that Range-read pixels equal IRSA's own cutout. The cut-off agent reported no measurements. Brief: build prompt 8.20, section 9 signatures, section 16 checks.
2. **Exposure encoding (adversarial review, contract section 7).** Linear u16 with step up to noise / 2 leaves tails when frames are rebuilt (Eros: 1 percent of sky pixels off by more than 1 sigma). Proposed, not started: asinh companding per exposure (`value = round(asinh(x / noise) / step) + 32767`), which keeps both the sky and the 25000 sigma peak of Eros with no clipping. It changes `exposures.json` keys, so it needs a `contract` issue, and three decoders must change together: `read_exposures` in `export_web.py`, `decodeExposures` in `WavelengthSwitch.tsx`, `decodeExposures` in `spectra.ts`. At the same time tighten the rebuild recipe text: all selected planes count for the "3 or more" rule; clip strictly beyond 3 sigma; MAD of 0 means no clipping; 5 iterations (astropy default), not "until nothing more is clipped"; the frame noise uses the median as centre and a population standard deviation; a frame with no exposure passing the filter is skipped; wavelength interpolation clamps to the nearest cell centre at the edges.
3. **Not started.** `web/lib/overlays.ts` + `web/app/api/overlay` (`mode=round` returns nothing, unit test; the catalog JSON it reads now exists; publish the `/api/overlay` and `/api/quicklook/list` JSON through a `contract` issue first, as promised on PR #6; SERVER enforces the lock with an `unlock` cookie, see api.md). `web/components/SpectrumChart.tsx`, `LightCurveBars.tsx` (their libraries are done), render tests for all DATA components (none exist; `jsdom` is installed). `docs/DEMO.md` (ship phase; needs the finished site). The `asset-license-audit` skill run. Phase 5 science checks (GAME's Color by time on Eros correlates at least 0.9 with `onion_dark.png`; JPL diamonds within 2 px of the answer key on Eros: the data side of this is already shown, 0.02 px). Cut-list items only if time: star targets, `build_pool.py`.
4. **Remaining review findings in `pipeline/export_web.py`.** Use SPHEREx as the Horizons observer (`500@-163182`) and mid-exposure times: Eros centroid offsets drop from about 0.45 px to about 0.23 px (do it in `pipeline/`, never by changing `motion_frames.track_positions`). The plan's middle source step, "re-run `motion_frames.py`" when FITS is missing, is skipped (`pipeline/dev/rebuild_inputs.sh frames` does it by hand). `test_known_object_is_where_jpl_says` only checks its own bounds: add a comparison against a recorded Horizons reply. Untested: wavelength grids against the spectral WCS, determinism of a re-export.
5. **Catalog loose ends.** Re-run `pipeline/catalog_facts.py --all` when SIMBAD is back (`simbad.cds.unistra.fr` answered "page currently unavailable" from 04:45 on; each run takes about 10 minutes per spot because JPL's identification API needs about 100 s per call). Nobody has reported on: bright Gaia stars landing on bright pixels, the epoch of SIMBAD coordinates, the proper-motion maths against astropy.
6. **Reviews owed.** GAME's PR #9 was a draft at 05:17; review it when ready (check it does not branch on `kind`, `title` or `difficulty === "control"` any more; nearest-neighbour drawing; `nodata` fallback). The final adversarial pass over all of PR #11's content. One review of SERVER's work.
7. **Credits loose ends (need a person or a working network).** The SIMBAD acknowledgment sentence (server down). The AWS Open Data citation sentence (registry.opendata.aws is blocked from the DATA machine). IRSA asks to cite the canonical SPHEREx papers (Bock et al. 2026, Akeson et al. 2026): no row yet. The repo cites Lupton et al. 1999 but has a link only for the 2004 paper. Mamajek's table header asks users to email the author when the table is used in research.

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
