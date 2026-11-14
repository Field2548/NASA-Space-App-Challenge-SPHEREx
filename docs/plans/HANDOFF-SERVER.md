# SERVER agent handoff

For whoever continues as the SERVER agent (a person or another Claude session).
Updated 2026-11-15 05:50 Bangkok. Check `git log -1 -- docs/plans/HANDOFF-SERVER.md` for its age.

## Start here (5 minutes)

1. Read `docs/plans/00-COORDINATION.md`, then `docs/plans/PLAN-3-server-map.md` (your task list), then `docs/contracts/api.md` (the contract you own, now version 1.2).
2. `git fetch origin && git checkout web-server && git pull`. Never push to `web` or `main`; deliver by PR into `web` (PR #6 is the open one).
3. In `web/`: `npm ci`, `npx next typegen`, `npx vitest run`, `npx tsc --noEmit`, `npx eslint`, `npx next build`.
   On Windows run them from a path with an **upper-case drive letter** (`cd /D/NASASpaceAppChallenge/web`). From `d:\...` every vitest file fails to load with "Cannot read properties of undefined (reading 'config')".
4. GitHub CLI: `gh auth status`. In Git Bash on the first machine: `export PATH="$PATH:/c/Program Files/GitHub CLI"`. Post on the board (issue #2): `[SERVER] I am @<your login>, taking over from @msipsb`.
5. Start the poll loop: `/loop 15m run scripts/poll.sh server and act on anything addressed to SERVER`.

## How the owner wants this run

- Orchestrate: give work to sub-agents in batches of related files (haiku for mechanical work, sonnet for normal code, opus for hard design and review). Integrate, run the checks yourself, commit, push, talk on GitHub. Use as few tokens as possible.
- After finishing a piece of work, have a fresh adversarial sub-agent check it from the real files. Do not trust memory.
- Goal: no caveats and no TODOs left on SERVER's side, our work and the others' work checked, no request from another agent open.
- Gated, need a `[HUMAN]` yes in issue #3: production deploy, push to `main`, deletions, Python signature changes.
- The account's opus and sonnet sub-agent budget ran out at about 05:40 and resets at 09:10 Bangkok. Haiku still worked at 05:45.

## State at 05:50: all pushed on `web-server` (cc2588b), in PR #6

Checks run by the orchestrator at cc2588b: vitest 198 passed (13 files), tsc clean, eslint clean, `next build` ok.

| What | Where | How far it is checked |
| --- | --- | --- |
| API contract 1.2 | `docs/contracts/api.md` | DATA ok on 1.0; GAME re-reviewed 1.1 (lock blocker resolved, not yet formally approved); 1.2 announced on the board, no objection yet |
| Scoring and `POST /api/check` | `web/lib/scoring.ts`, `web/app/api/check/route.ts` | tests; real HTTP run on an earlier version; adversarial review done and its fixes applied |
| Unlock cookie, helpers, rate limit | `web/lib/server/{unlock,http,rateLimit}.ts` | tests; review fixes applied |
| `GET /api/resolve` | `web/lib/server/sesame.ts` | tests; real Sesame lookups by curl. Not run through a live server |
| `GET /api/health`, `/status`, footer light | `web/lib/server/health.ts`, `web/app/status/`, `web/components/StatusBadge.tsx` | tests; one real run. CDS HiPS and SIMBAD answered 404 for every path that night, so those two probe URLs are unconfirmed. Page not viewed in a browser |
| HEALPix maths | `web/lib/healpix.ts` | tests only |
| Leaderboard, density, request queue, keep-alive, `/requests`, cron | `web/app/api/{leaderboard,density,request-spot,keepalive}/`, `web/lib/server/{db,bot}.ts`, `web/lib/supabase.ts`, `web/vercel.json` | tests for the no-database paths only. **Nothing that needs a real Supabase has ever run** |
| Database migration | `supabase/migrations/20261115000000_init.sql`, `supabase/tests/rls_probe.sql` | run in a scratch Postgres 16 (PGlite) with faked Supabase roles. Never run on real Supabase |
| Sky map, coordinate box | `web/components/{SkyMap,CoordinateBox}.tsx`, `web/components/skymap/`, `web/app/skymap-demo/` | tests for the geometry helpers; builds. **The sub-agent was cut off before its report: the browser check is unconfirmed. Open `/skymap-demo` and look** |

Two sub-agents (review fixes, sky map) were cut off by the usage limit just before their final reports. Their files pass all checks, but nobody has read their reports: treat both as "passes tests, not reviewed".

## In progress when this was written

- Haiku sub-agent: shared `isAboveBar` rule for scoring and the bot row; leaderboard 404 for an unknown spot; `spot_reveal` in the `/api/check` response (issue #10). May be uncommitted in the working tree: run the checks, then commit.
- Haiku sub-agent: read-only review of DATA's PR #11 (SERVER reviews DATA). Post the result on the PR, approve or request changes.

## Open items, in order

1. Review DATA's PR #11, then merge `origin/web` into `web-server` after it lands (answer keys gain `reveal`; public titles become neutral; Cygnus `difficulty` becomes `medium`).
2. Adversarial pass over the batches that have had none: data routes, health, resolve, sky map, the review-fix commit itself.
3. Rework the data routes to contract 1.2: `/api/density` `who=others`; finds on ready spots stored at the spot centre; `find_key` and `p_practice` passed to `record_find`.
4. Not started (PLAN-3): `InspectPopup.tsx` (needs DATA's `LightCurveBars`), `AuthDialog.tsx`, `Scoreboard.tsx`, saving finds in `/api/check`, `/api/complete`, `/api/info` with the lock (needs DATA's `web/data/catalog/<slug>.json`; only Eros existed at 05:00), `pipeline/process_requests.py`, quick-look submit path, `/api/s3range` (only if DATA's S3 CORS check, not done yet, says so).
5. Ask GAME (their files): `CheckResponse.practice?: boolean` in `types.ts`; a footer slot for `StatusBadge`; `outputFileTracingIncludes` for `./data/**` and `./public/fields/**/field.json` in `next.config.ts` (the local build traced the files without it; confirm on the first Vercel preview); where `SkyMap` and `CoordinateBox` mount; then delete `/skymap-demo`.
6. Phase 5: licence audit, Vercel preview, production deploy after a human yes, live checklist on the board.

## Waiting on others

- Human (issue #3): Supabase project and keys (item 1), Vercel link (item 2), `UNLOCK_SECRET` (item 13, added by SERVER). Without `UNLOCK_SECRET` in production, finished spots lock again; play and scoring still work.
- DATA: catalog files for four spots, the S3 CORS check, vetting of bot candidates that are not the known object (they now earn 0 points, so this no longer affects scores).
- GAME: formal approval of PR #6.

## Decisions SERVER made that the build prompt does not spell out

All are written in `docs/contracts/api.md`. The owner may overrule them.
- A spot unlocks only after a correct answer. After that, answers there are practice and earn 0 points.
- A bot match that is not a known object earns 0 points. The Cygnus "nothing moved" spot gives 250.
- Ready spots stay locked on the sky map and in free explore until the player has a correct answer there (the build prompt says "always open" there).
- Finds on ready spots are stored at the spot centre.
- Aladin Lite is pinned to 3.8.2 (GPL-3); the 3.9 beta is LGPL.

## Windows traps

- npm on Windows rewrites `web/package-lock.json` and drops optional Linux packages, which breaks `npm ci` in CI. After adding a dependency, `git diff --stat origin/web -- web/package-lock.json` should show only the new packages. If it shows hundreds of deleted lines, restore the lock from git and add only the new entries.
- `python -` in Git Bash waits on stdin and hangs a command. Use `node -e` for small scripts.

## People

GAME is @toonzzzrock (branch `web-game`, reviews SERVER). DATA is @Field2548 (branch `claude/great-galileo-8dyj6n`, SERVER reviews DATA; hand-off file `docs/plans/HANDOFF-DATA.md` on that branch). Human decisions: issue #3. Board: issue #2.
