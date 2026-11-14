# DATA agent hand-off (kept current; last update 2026-11-15 04:24 Bangkok)

For whoever continues the DATA plan (`docs/plans/PLAN-1-data-science.md`) if the current DATA session runs out of budget. Everything you need is in this file and on GitHub; nothing lives only in the old session.

## How to take over

1. Read `docs/plans/00-COORDINATION.md`, then `docs/plans/PLAN-1-data-science.md`, then this file.
2. Work on the DATA branch. The first DATA session could push only to `claude/great-galileo-8dyj6n` (its harness forbade other branches); the plan's name is `web-data`. Use whichever your session allows, branch from the tip of `claude/great-galileo-8dyj6n`, and say on the board (issue #2) which branch DATA uses now.
3. Post `[DATA] I am @<login>, taking over from the previous DATA session` on issue #2 and start the 15-minute poll (coordination 3.4). `gh` may not work in every harness; the poll is: open issues labelled `to:data`, comments on #3, open PRs, the last comments on #2, and `git log HEAD..origin/web`.
4. Rebuild the local inputs (they are gitignored, so a fresh machine has none): create a venv (`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest`, any Python 3.13+ works), then `pipeline/dev/rebuild_inputs.sh frames` and `pipeline/dev/rebuild_inputs.sh bands`. Needs network access to `irsa.ipac.caltech.edu`; the answer keys and catalog facts also need `ssd.jpl.nasa.gov`, `ssd-api.jpl.nasa.gov`, `simbad.cds.unistra.fr`, `gea.esac.esa.int`. Without those hosts you can still run every test that reads committed files.
5. Check the state yourself before trusting this file: `.venv/bin/python -m pytest pipeline/tests -q` and `cd web && npm ci && npx vitest run && npx tsc --noEmit`.

## Standing instructions from the human (Field2548)

- DATA works as an orchestrator: implementation goes to sub-agents (haiku, sonnet, opus) in batches of related files; the main session plans, verifies, commits and talks on GitHub.
- When work is finished, an adversarial sub-agent re-checks everything from the files, not from memory (also coordination section 9).
- Goal: keep refining until no caveats and no todos remain, check our own work, then check GAME's and SERVER's work once, and leave no request from the others unanswered.
- Not yet answered by the human (ask again, do not assume): may DATA merge its own PRs into `web` and approve GAME's PRs as the plan says, and may DATA push to `web-data`? Until a yes: open PRs, review by comment only, let GAME or SERVER merge.

## Done and merged into `web`

| What | Where | Proof |
| --- | --- | --- |
| Field schema contract v1 | `docs/contracts/field-schema.md` | PR #5 |
| Fixture spot | `pipeline/make_fixture.py`, `web/public/fields/fixture/`, `web/data/answers/fixture.json` | pytest |
| Five ready spots at float precision, answer keys, `index.json` | `pipeline/export_web.py --all`, `web/public/fields/<slug>/`, `web/data/answers/<slug>.json` | pytest: 47 passed |
| Single exposures (`exposures.u16` + `exposures.json`) for all five | same exporter, contract section 7 | rebuilding a frame from its exposures reproduces `frames.u16` (median about 0.03 sigma) |
| Credits rows | `docs/credits/data.csv` | IRSA and SPHEREx acknowledgment sentences were fetched from IRSA, not typed from memory |

## Done on the DATA branch, not yet in a PR

- `LICENSE` (GPL-3.0, byte-identical to Debian's `common-licenses/GPL-3`) and `docs/DECISIONS.md` (build prompt section 14, verbatim).
- `pipeline/dev/rebuild_inputs.sh` and this file.

## In progress (uncommitted work of sub-agents in the first session's checkout; if that session died, redo these from the plan)

| Task | Files | State at last update |
| --- | --- | --- |
| Catalog facts | `pipeline/catalog_facts.py`, `pipeline/tests/test_catalog.py`, `web/data/catalog/*.json`, contract section 9, credit rows for SIMBAD, Gaia, JPL SB Identification | first draft written, being run and tested |
| Spectrum tiles | `pipeline/spectrum_tiles.py`, `--bands` hook in `export_web.py`, `pipeline/tests/test_spectrum.py`, `web/public/fields/<slug>/spectrum/` | being built; cubes for eros and eris exist, makemake, hektor, cygnus still downloading |
| Science libraries | `web/lib/spectra.ts`, `web/lib/inspect.ts`, tests, `web/public/ref/molecule_bands.json`, `web/public/ref/spt_teff.json` | started |
| Wavelength switch | `web/components/WavelengthSwitch.tsx` (+ hook `useWavelengthFrames`, tests) | started |
| Quick look | `web/lib/{fits,sipwcs,quicklook}.ts`, `web/workers/quicklook.ts`, `web/app/api/quicklook/list/route.ts`, tests, S3 CORS check | started |
| Adversarial review of everything merged so far | read-only | running; fix every BLOCKER and MAJOR it reports |
| Review of GAME's scaffold (PR #7, already merged by GAME) | read-only | running; post findings as a `[DATA]` comment or issues to GAME |

## Not started

- `web/lib/overlays.ts` + `web/app/api/overlay` (`mode=round` returns nothing, unit test); publish the `/api/overlay` and `/api/quicklook/list` JSON through a `contract` issue first (promised to SERVER on PR #6).
- `web/components/SpectrumChart.tsx`, `LightCurveBars.tsx`, `QuickLook.tsx`.
- A `contract` issue to GAME for the `useWavelengthFrames(field, selection)` hook shape.
- `scripts/credits-check.*`, merged `CREDITS.md` with the borrowed-ideas table (build prompt 13), README sections "Website", "How we used AI", "Acknowledgments", `docs/DEMO.md`, the `asset-license-audit` skill run (aladin-lite is an approved GPL exception).
- Phase 5 science checks: GAME's Color by time on Eros correlates at least 0.9 with `onion_dark.png`; JPL diamonds within 2 px of the answer key on Eros.
- Cut-list items, only if time: star targets, `build_pool.py`.

## Facts that cost time to learn

- JPL's Small-Body Identification API refuses `mpc-code=500` (the build prompt suggested it). A geocentric observer is `xobs=0,0,0,0,0,0`; verified on the Eros field.
- Eros leaves the 0.2 degree picture after frame 3. Its answer-key positions for frames 4 and 5 have `in_grid: false`. The plan's test "Eros track pixel inside the grid for every frame" cannot hold; the test in `pipeline/tests/test_export.py` states the real behaviour.
- SPIFF brown-dwarf templates are NOT loaded (issue #3 item 5, default no): comparison is blackbody only and the UI must say so.
- The PNG fallback (`frames_from_png`) is only a fallback now; all five spots come from FITS. Its S/N numbers are approximate (within about 0.09 sigma on sky, 20 percent on sources); the picture it gives is exact.
- Rebuilt FITS frames reproduce the committed preview PNGs with 0 gray levels of difference, so the web data and the README figures show the same pixels.
- Committed `frames.csv` files have Windows line endings; strip `\r` before comparing.
- The team clock: use `TZ=Asia/Bangkok date`, never guess the time in board posts.
- `scripts/poll.sh` needs the `gh` CLI with GraphQL; in the first session only the GitHub MCP tools worked.

## Open questions and caveats

- Hektor has three bot candidates above its 6.4 sigma bar (rank 1 is Hektor itself). Ranks 2 and 3 are unconfirmed; SERVER gives full points for a `bot_match`. Nobody has checked whether they are real objects.
- `objects[].vx/vy_px_per_day` in answer keys is a straight-line summary; for Eros it is far from the real path. Score against `positions`.
