# SERVER agent handoff

For whoever continues as the SERVER agent (a person or another Claude session).
Written 2026-11-15 04:25 Bangkok. The previous session keeps this file current; check `git log -1 -- docs/plans/HANDOFF-SERVER.md` for its age.

## Start here (5 minutes)

1. Read `docs/plans/00-COORDINATION.md`, then `docs/plans/PLAN-3-server-map.md` (your task list), then `docs/contracts/api.md` (the contract you own).
2. `git fetch origin && git checkout web-server && git pull` (never push to `web` or `main`; deliver by PR into `web`).
3. In `web/`: `npm ci`, then `npx next typegen`, `npx vitest run`, `npx tsc --noEmit`, `npx eslint`, `npx next build`.
4. GitHub CLI: `gh auth status`. In Git Bash on the first machine it needs `export PATH="$PATH:/c/Program Files/GitHub CLI"`. Post on the board (issue #2) as `[SERVER] I am @<your login>, taking over from @msipsb`.
5. Start the poll loop: `/loop 15m run scripts/poll.sh server and act on anything addressed to SERVER`.

## How the owner wants this run

- Be an orchestrator: give work to sub-agents in batches of related files (haiku for mechanical work, sonnet for normal code, opus for hard design and review). Integrate, run the checks yourself, commit, push, talk on GitHub.
- After finishing a piece of work, have a fresh adversarial sub-agent check it from the real files. Do not trust your own memory of what was done.
- Goal: keep refining until there are no caveats and no TODOs left on SERVER's side, our work and the others' work are checked, and no request from another agent is open.
- Gated, need a `[HUMAN]` yes in issue #3: production deploy, push to `main`, deletions, Python signature changes.

## Done and checked

| What | Where | Evidence |
| --- | --- | --- |
| API contract 1.1 | `docs/contracts/api.md` | PR #6. DATA said ok. GAME asked for a server-enforced spoiler lock; done in 1.1; re-review asked, not yet given |
| Credits rows | `docs/credits/server.csv` | npm licences checked with `npm view` |
| Scoring | `web/lib/scoring.ts`, `web/lib/scoring.test.ts` | vitest passed; checked against all 5 real answer keys |
| `POST /api/check` (no database) | `web/app/api/check/route.ts` | vitest passed; real HTTP on `next start`: Eros gives `known`, 100 points |
| Route helpers, rate limit, unlock cookie | `web/lib/server/{http,rateLimit,unlock}.ts` | vitest passed |
| Reviewed and merged DATA's PR #5 | 5 real spots + fixture | frames decoded and compared with the answer keys |

## Done by sub-agents, reported passing, not yet re-verified by the orchestrator

| What | Where | Note |
| --- | --- | --- |
| `GET /api/resolve` (CDS Sesame) | `web/lib/server/sesame.ts`, `web/app/api/resolve/route.ts` | Sesame answers with a 302 redirect; the route was not run through a live server |
| HEALPix maths | `web/lib/healpix.ts` | 20 tests reported passing |

Both are committed in df32079 and pushed; CI on PR #6 is the independent check. Look at `gh pr checks 6`.

## In progress when this was written

- Sub-agent: `/api/health`, `/status` page, `web/components/StatusBadge.tsx`, `web/lib/server/health.ts`. Files may exist uncommitted in the working tree. Verify, then commit.
- Sub-agent (opus): adversarial review of the contract, the SQL migration, scoring, the unlock cookie and `/api/check`. Its findings are not applied yet. If its report is lost, run the review again.

## Known problems and caveats

- **SQL migration has never been run.** `supabase/migrations/20261115000000_init.sql` was written with no Postgres available. Run it on a real Supabase project (or local Postgres) before trusting it. Watch for ambiguous column names in `record_find`.
- **No Supabase project yet** (issue #3 item 1). Everything must keep working with no database.
- **Local `node_modules` in `web/` may be broken** on the first machine (vitest failed to load every file at 04:23 after npm commands ran while a build was running). Fix: `npm ci`.
- **Windows npm rewrites `package-lock.json`** and drops optional Linux packages, which breaks `npm ci` in CI. After adding a dependency, check `git diff --stat origin/web -- web/package-lock.json`: it should be a few lines. If it is hundreds, restore the lock from `origin/web` and add only the new entries.
- **Bot candidates that may be noise:** Hektor ranks 2 and 3 and Eris rank 2 are just above their noise bars and score full points as `bot_match`. Raised with DATA in the PR #5 review; no answer yet.
- **Aladin Lite licence:** npm says LGPL-3.0-or-later, the build prompt says GPL-3.0. Settle it in the licence audit.
- `/api/check` returns `first_finder: false`, `persisted: false` always until the database is wired.
- Answer keys are read with `fs` from `process.cwd()/data/answers`. The build traced them into the function bundle locally; confirm again on the first Vercel preview.

## Not started (from PLAN-3)

Phase 2: `SkyMap.tsx` (Aladin Lite, SPHEREx HiPS), coordinate box, `InspectPopup.tsx` shell (sections A, B, F), S3 CORS fallback `/api/s3range` (only if DATA's check says it is needed).
Phase 3: `web/lib/supabase.ts`, `AuthDialog.tsx`, persistence in `/api/check`, `/api/complete`, `/api/leaderboard` + `Scoreboard.tsx` + `public/leaderboard-snapshot.json`, `/api/density`, `/api/request-spot` + `/requests` + `pipeline/process_requests.py`, `/api/keepalive` + `vercel.json` cron, `/api/info` with the spoiler lock (needs DATA's `web/data/catalog/<slug>.json`), Inspect sections D, E, G.
Phase 4: quick-look submit path (`sb_ident`), design pass.
Phase 5: licence audit, Vercel preview, production deploy after a human yes, live checklist on the board.

## People

GAME is @toonzzzrock (branch `web-game`, reviews SERVER). DATA is @Field2548 (branch `claude/great-galileo-8dyj6n`, SERVER reviews DATA). Human decisions: issue #3. Board: issue #2.
