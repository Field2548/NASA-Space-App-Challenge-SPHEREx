# 00 - Coordination: read this before your own plan

Goal: take `NASA-Space-App-Challenge-SPHEREx` from an empty `main` to a public Vercel site (the SPHEREx moving-object game).
Hard deadline: **Sunday 2026-11-15, 22:00 Bangkok (UTC+7)**. Feature freeze 19:00. Production deploy done by 21:00.
Plan was written at 03:30 Bangkok, so the phase windows below are real. Run `date` at session start and drop items from the cut list (section 7) if you are behind.

Source of truth for every detail: `docs/BUILD_PROMPT.md` (the full build prompt). Plans cite it as `BP section N`. If a plan and BP disagree, the plan wins for who-does-what, BP wins for behaviour.

## 1. Who does what

| Plan | Agent name | Branch | Owns (summary) |
| --- | --- | --- | --- |
| `PLAN-1-data-science.md` | **DATA** | `web-data` | Python export pipeline, ready-spot data, answer keys, catalog facts, spectrum cubes, reference spectra, quick look (browser Range reads + TAN-SIP), spectrum and overlay libraries, credits, license, docs |
| `PLAN-2-game-frontend.md` | **GAME** | `web-game` | Next.js scaffold, design system, field viewer, image tools, color vision, timeline, frames and spacing, tutorial, title page, guest mode, embed, e2e for the game loop |
| `PLAN-3-server-map.md` | **SERVER** | `web-server` | Supabase, all API routes, scoring, auth, scoreboard, sky map (Aladin), density layers, Inspect popup, status page, request queue, Vercel config and production deploy |
| `PLAN-H-human-reserved.md` | **HUMAN** | n/a | Reserved for the human teammate: accounts, secrets, laptop data runs, approvals, submission. Agents never do these; they ask for them (section 5) |

Integration branch: `web` (already on origin, made from `origin/Film`, which holds the Python pipeline, CLAUDE.md, `data/motion_*`). Agent branches use a dash (`web-game`), never a slash: git cannot hold `web/game` next to an existing `web` branch. Each agent runs on its own machine with its own GitHub account. Never push to `main` and never deploy to production without the human saying yes in issue #3 (3.6).

## 2. File ownership (avoids merge conflicts)

One owner per path. Editing a path you do not own = open an issue to the owner, or a PR that the owner reviews.

| Path | Owner |
| --- | --- |
| `pipeline/**`, `data/bands_*`, `web/public/fields/**`, `web/data/**`, `web/public/ref/**` | DATA |
| `web/lib/{spectra,inspect,fits,sipwcs,quicklook,overlays}.ts`, `web/workers/quicklook.ts` | DATA |
| `web/components/{SpectrumChart,LightCurveBars,QuickLook,WavelengthSwitch}.tsx` | DATA |
| `web/app/api/{quicklook,overlay}/**` | DATA |
| `CREDITS.md`, `LICENSE`, `docs/DECISIONS.md`, `docs/DEMO.md`, `scripts/credits-check.*` | DATA |
| `web/package.json` base, `web/app/layout.tsx`, `web/app/globals.css`, `web/lib/types.ts` | GAME |
| `web/app/{page,tutorial,play,embed,about,credits}/**`, `web/components/*` not listed elsewhere | GAME |
| `web/lib/{coords,wcs,fields,framePicker,imaging,palettes,marks}.ts` | GAME |
| `supabase/**`, `web/lib/{supabase,scoring,healpix}.ts`, `vercel.json` | SERVER |
| `web/app/api/*` except quicklook and overlay, `web/app/{status,requests}/**` | SERVER |
| `web/components/{SkyMap,Scoreboard,AuthDialog,InspectPopup,StatusBadge}.tsx` | SERVER |
| `pipeline/process_requests.py` | SERVER (only file in `pipeline/` it owns) |
| `scripts/poll.sh` | shared; change only through a `contract` issue |
| `docs/plans/**`, `docs/contracts/**` | the agent named in the file; contracts are changed only through a `contract` issue (section 4) |

Shared files with special rules:
- `web/package.json`: add a dependency in its own tiny commit, then `git pull --rebase origin web` at once. Never reformat the file.
- `CREDITS.md`: do not edit by hand. Each agent appends rows to `docs/credits/<agent>.csv` (columns: name, author, link, license, used_for, date_checked). DATA's script merges them. Add a row the same commit you add the dependency, dataset, font, or idea.
- `web/app/layout.tsx` and `globals.css`: GAME only. Others ask via issue for a slot.

## 3. How you talk to each other: GitHub is the only channel

Agents run in separate sessions and share nothing except the repo. If it is not on GitHub, the others do not know it.
Everyone has fetch and push rights (granted by the human). Use the `gh` CLI.

Every comment on any issue or PR starts with your tag: `[DATA]`, `[GAME]`, `[SERVER]`, `[HUMAN]`. Your first board comment is `[ROLE] I am @<github-login>`, so everyone can map accounts to roles (GAME is @toonzzzrock).

**3.1 Team board.** Issue **#2 "TEAM BOARD"**, pinned. All labels in 3.2 already exist. Every agent posts one comment there:
- at start of each phase (section 6) and at each finished milestone,
- at least once per hour while working,
- immediately when blocked.

Comment format (keep it short):
```
[DATA] 06:10  phase 1 done
done: export_web.py writes eros+hektor (commit abc1234)
next: cygnus, makemake, eris
blocked on: nothing
need from GAME: confirm u16 layout in docs/contracts/field-schema.md
```

**3.2 Issues = requests between agents.** Create with labels `from:<agent>` and `to:<agent>` (agents: `data`, `game`, `server`, `human`), plus one of `contract`, `blocked`, `question`, `bug`, `ask-human`. Title starts with the thing needed. Body: what, why, path or commit, and what "done" looks like. The receiver comments "taking it" within 15 minutes and closes the issue with a commit link.

**3.3 Pull requests = delivery.**
- Work on your own branch (`web-data`, `web-game`, `web-server`). Commit small and often, push after every commit.
- Never push straight to `web`; it changes only through `gh pr merge --squash`. This avoids rejected pushes when two agents land at once.
- Open a PR into `web` at every milestone. In the PR body paste the summary line of your local test run (pytest, vitest, `next build`); there is no CI, so this is the green check. Merge only after the reviewer approves (`gh pr review --approve`), or after 20 minutes of silence with that test line present (then comment "merging, no review").
- Review pairs: DATA reviews GAME, GAME reviews SERVER, SERVER reviews DATA. Add the reviewer with `gh pr edit --add-reviewer <login>` and tag their role on the board.
- Review means: run it, read the diff for contract breaks, then `gh pr review --approve` or `--request-changes -b "..."`. Do not rewrite their code; request a change.

**3.4 Poll routine** (at session start, after every merge, before starting a new task, and every 15 minutes). A Claude session does nothing until prompted, so start a loop at session start, e.g. `/loop 15m run scripts/poll.sh <me> and act on anything addressed to <me>`. Without it the 15-minute reply rule cannot be met.
```
scripts/poll.sh <data|game|server>   # read-only: issues to you, ask-human, PRs, board #2, new commits on web
git pull --rebase origin web         # onto your branch, after committing your work
```

**3.5 Contract changes.** Shared formats live in `docs/contracts/`: `field-schema.md`, `api.md`, `types.md`. To change one, open an issue labelled `contract` with the exact before and after, tag the other two agents, wait for both to comment "ok" (or 20 minutes), then change the file and announce on the board. Never change a contract silently.

**3.6 Human questions.** The humans are offline overnight, so agents run fully unattended. Every human decision is batched in issue **#3**, each with a default that is in effect until a `[HUMAN]` comment there overrides it. Never wait for an answer and never open another `ask-human` issue: a new question goes as one comment on #3 stating the default you are applying, then you carry on with it. Poll #3 for overrides. Only the gated items in #3 (production deploy, push to `main`, deletions, Python signature changes) stay undone until a yes. Loading the SPIFF pickle also needs a yes (default no).

## 4. Contracts to publish in the first 40 minutes (unblocks everyone)

| Contract | Written by | Content |
| --- | --- | --- |
| `docs/contracts/types.md` + `web/lib/types.ts` | GAME | `Field`, `FrameMeta`, `Track`, `Verdict`, `Vision`, `RGB`, `Difficulty`, `Spectrum`, `ExposureMeta` (types from BP section 9) |
| `docs/contracts/field-schema.md` + fixture spot `web/public/fields/fixture/` | DATA | field.json, frames.u16 layout (little-endian Uint16, N x H x W, rows top-down, `value = round((S/N - offset)/scale)`), thumbs, exposures, spectrum tiles. The fixture is a tiny synthetic spot (e.g. 32x32, 4 frames, one moving dot) so GAME and SERVER can build before real data lands |
| `docs/contracts/api.md` | SERVER | request and response JSON for every route in BP section 9 (route list), error shape, the `mode=round|explore` spoiler rule, `/api/check` verdict object |

Until the real data lands, GAME and SERVER develop against `fixture`. DATA must not rename fields after publishing without a `contract` issue.

## 5. Handoff dependencies (who waits for whom)

| Need | From | To | Needed by |
| --- | --- | --- | --- |
| `web/` scaffold + `types.ts` on `web` | GAME | all | 04:00 |
| fixture spot + field schema | DATA | GAME, SERVER | 04:00 |
| API contract + `/api/check` stub (reads answer JSON, no DB) | SERVER | GAME | 06:00 |
| 5 real spots exported (PNG fallback ok) | DATA | all | 06:00 |
| `exposures.u16` for 5 spots | DATA | GAME (wavelength switch) | 10:00 |
| `catalog/<slug>.json` | DATA | SERVER (`/api/info`, overlay) | 12:00 |
| spectrum tiles + reference spectra | DATA | SERVER (Inspect C) | 14:00 |
| Supabase URL and keys in env | HUMAN | SERVER | 10:00 |
| laptop with FITS: run export and `spectral_bands.py` | HUMAN | DATA | 04:30 |
| Vercel project linked | HUMAN | SERVER | 12:00 |

## 6. Phases (Bangkok time), same windows for all three agents

| Window | Phase | Shared exit |
| --- | --- | --- |
| 03:30 - 04:00 | 0 Setup | branches exist, scaffold on `web`, contracts published, board open, first preview deploy |
| 04:00 - 08:00 | 1 MVP | safety-net demo: viewer, Color by time, Show only changes, marking, `/api/check` local, tutorial levels 0-1, guest mode, 5 spots |
| 08:00 - 12:00 | 2 Explore | sky map, coordinate box, remaining tools, color vision, frames and spacing, tutorial 2-5, Inspect A B F, wavelength switch, `/status` |
| 12:00 - 16:00 | 3 Accounts | auth, scoreboard, density, requests, keep-alive, Inspect D E G with spoiler lock, overlays, quick look steps 1-3 |
| 16:00 - 19:00 | 4 Polish | spectrum view, quick look marking, credits, design pass, mobile basics |
| 19:00 | **Freeze** | bug fixes only |
| 19:00 - 21:00 | 5 Ship | tests, license audit, ask human, production deploy, live e2e, DEMO.md |
| 21:00 - 22:00 | Buffer | human submits |

## 7. Cut list (same for everyone, in order)

Follow and stack, distance hint, spectrum hints, star-target spots, build_pool, mobile layout, realtime scoreboard refresh, P3 canvas (keep CSS P3), density at many zooms (keep one), live Inspect on sky map, temperature guess, compare to types (keep rainbow chart), quick-look marking (keep quick-look viewer).
Never cut: tutorial levels 0 and 1, guest play, credits and acknowledgments, the "Nothing moved" answer.
The owner of a cut item announces the cut on the board so nobody builds against it.

## 8. Rules every agent follows (from BP sections 13 and 18)

- Ideas from other teams only, all code our own. Credit every dataset, API, library, font, paper, and borrowed idea in `docs/credits/<agent>.csv`.
- No NASA logos, no wireframe pictures, no AI images, no hotlinked media. Lucide icons and own SVG only.
- No secrets in git. Service key never reaches the browser. Points are computed only on the server.
- Never change an existing Python function signature. Never claim a detection without its noise bar. Never invent data.
- Nearest-neighbour upscaling, one shared stretch across frames, flashing capped at 3 frames per second.
- Commit messages in plain English: what and why. No force-push to shared branches.

## 9. Definition of done (team)

BP section 19 checklist. Each plan lists its own share. The SERVER agent runs the final checklist on the live URL and posts the result on the board; the human submits.
