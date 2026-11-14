# PLAN 3 - SERVER agent (accounts, API, sky map, Inspect, deploy)

Branch: `web/server`. Read first: `docs/plans/00-COORDINATION.md`, then `docs/BUILD_PROMPT.md` (BP) sections 3, 7, 8.2, 8.3, 8.10 to 8.12, 8.14, 8.16, 8.19, 9 (routes), 10, 11, 17, 18, 19.
Skills: `supabase`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `deploy-to-vercel`, `asset-license-audit`, `webapp-testing`.

Your job in one line: everything server-side and everything that needs a database, the sky map, the Inspect popup shell, and getting the finished app onto Vercel.

## Who you depend on, who depends on you

| You need | From | You give | To |
| --- | --- | --- | --- |
| scaffold, `types.ts` | GAME | `docs/contracts/api.md` (within 40 min), `/api/check` stub (06:00) | GAME, DATA |
| fixture, answer-key and catalog shapes | DATA | `InspectPopup` with slot for `SpectrumChart` | DATA, GAME |
| Supabase and Vercel setup | HUMAN | final deploy and live checklist | HUMAN |
| `SpectrumChart`, `inspect.ts`, `overlays.ts` | DATA | CORS fallback route `/api/s3range` if needed | DATA |

## Phase 0 (03:30 - 04:00)

- [ ] `git checkout -b web/server origin/web` (wait for GAME's scaffold; meanwhile write SQL and the API contract in `docs/contracts/api.md`: every route in BP section 9 list, request and response JSON, zod schemas, error shape, `mode=round|explore` rule, `/api/check` verdict `{kind: known|bot_match|candidate|static|nothing_correct|nothing_wrong, object_name?, points, message}`).
- [ ] Post on the board; tag GAME and DATA to confirm the contract (20 min).
- [ ] `docs/credits/server.csv`: Supabase, Vercel, Aladin Lite (GPL-3.0), CDS HiPS (ODbL), Sesame, SIMBAD, Gaia, JPL, zod, `@hscmap/healpix`.
- [ ] `ask-human` issue: Supabase project and keys, Vercel link, domain or project name.

## Phase 1 (04:00 - 08:00): check route without a database

- [ ] `lib/scoring.ts` (server only): `checkSubmission(slug, track | 'nothing')` against `web/data/answers/<slug>.json`: known object within 2 px in at least 2 frames; bot candidate within 2 px and about 2 px/day; "nothing moved" correct for Cygnus. `pointsFor(v, difficulty, firstFinder)`: Easy 100, Medium 250, Hard 500, Boss 1000, Expert 750, first finder plus 50 percent.
- [ ] `POST /api/check` working with answer JSON only (no DB, returns points but does not persist). Push to `web` and tell GAME at once.
- [ ] `GET /api/resolve?name=` (CDS Sesame XML, `<jradeg>`, `<jdedeg>`, 1-day cache).
- [ ] zod on every input, light rate limit. Never ship answers to the client (test: no answer JSON under `public/`).
- [ ] Vitest for scoring: Eros track gives "known", random clicks give nothing, Cygnus "nothing" gives `nothing_correct`.

## Phase 2 (08:00 - 12:00): sky map, health, Inspect without network

- [ ] `lib/healpix.ts` over `@hscmap/healpix` (NESTED, not `healpixjs`): `hpxNest`, `parent`, `cellCorners`. Test parent math.
- [ ] `components/SkyMap.tsx`: dynamic import `ssr:false` of pinned `aladin-lite`, HiPS `CDS/P/SPHEREx/QR2/color`, galactic frame, Mollweide or Aitoff, spot reticles colored by difficulty, preview card with Play, zoom buttons, pointer RA/Dec line. Not Aladin's default DSS background.
- [ ] Coordinate box component (BP 8.3) with dice; uses GAME's `parseCoordinates`; flies the map; offers Play, "Quick look (live)", "Request full processing". Agree props with GAME by issue.
- [ ] `GET /api/health` (all services in BP 8.19, 5 s timeout, parallel, 60 s cache) and `/status` page with lights. `StatusBadge.tsx` in footer. Plain-words failure explanations.
- [ ] `components/InspectPopup.tsx` shell (draggable, Esc, keyboard reachable, never covers the clicked pixel, title `INSPECT // px x,y`) with sections A (where: RA/Dec, galactic, ecliptic latitude hint), B (over time, uses DATA's `LightCurveBars` and `lightCurveAt`), F (can't tell). Slots for C, D, E, G.
- [ ] CORS for S3: ask DATA for the result of their day-one check. If blocked, implement `GET /api/s3range?key=` whitelisting only bucket `nasa-irsa-spherex`, passing `Range` through.

## Phase 3 (12:00 - 16:00): accounts and data

- [ ] `supabase/migrations/` from BP section 10: `profiles`, `finds`, `visits`, `spot_requests`, indexes, **RLS on every table**, only the server (service role) inserts into `finds`, public reads through views or RPC without emails or user ids. Apply to the HUMAN-created project.
- [ ] `lib/supabase.ts` (client and server). `AuthDialog.tsx`: email and password, display name 3 to 20 chars unique, "Play as guest", guest progress moves into the account on signup.
- [ ] `/api/check` persists `finds` and `visits`, computes points, first finder. `POST /api/complete`.
- [ ] `GET /api/leaderboard?scope=spot|all&slug=` and `Scoreboard.tsx`: collapsible thin tab, tabs "This spot / All time", columns rank, name, score, accuracy, "Show me at top", BOT row, ASCII empty state, refresh after submit and every 30 s, fallback to `public/leaderboard-snapshot.json` (generate it) when Supabase is down.
- [ ] `GET /api/density?layer=finds|checked&order=&who=me|all` using the shift-right SQL in BP 10; draw HEALPix polygons in Aladin, heat scale (P3 allowed here), my/others toggles.
- [ ] `POST /api/request-spot`, `/requests` page, `pipeline/process_requests.py` (reads queue with service key from local `.env`, runs the existing scripts and `export_web.py`, prints git commands).
- [ ] `GET /api/keepalive` protected by `CRON_SECRET`; `vercel.json` daily cron.
- [ ] `GET /api/info?spot=&x=&y=&ra=&dec=&mode=round|explore`: ready spots read DATA's `catalog/<slug>.json`; elsewhere SIMBAD TAP, Gaia TAP and JPL in parallel, 8 s timeout each, partial results ok, cache by position rounded to 1 arcsec. **`mode=round` returns no names, types, distances or JPL results**; test it.
- [ ] Inspect sections D, E (distance rules BP 8.16, uses `parallaxDistance`, `redshiftDistance` from DATA), G, with `[LOCKED] Names and distances unlock after you submit.` during rounds. Unlock after Submit, always in free explore.
- [ ] Mount DATA's `SpectrumChart` into section C (phase 4).

## Phase 4 (16:00 - 19:00)

- [ ] Quick look submit path: `/api/check` for quick-look marks runs `sb_ident` (observer `mpc-code=500`, field center, half-width, `obs-time`), saves candidate, no points, shows in Finds layer.
- [ ] Mobile bottom-sheet for Inspect only if time.
- [ ] `web-design-guidelines` pass on your components. Credits rows for anything added.
- [ ] Wire the final README links to `/about`, `/credits`.

## Phase 5 (19:00 - 21:00): ship

- [ ] Confirm all agents' PRs are merged into `web`; open PR `web` into `Film` (not `main`).
- [ ] Run `asset-license-audit` (approve `aladin-lite` GPL exception), DATA's `credits-check`, all vitest and Playwright runs. Zero blockers, or list them on the board.
- [ ] Set Vercel project root to `web/`, env vars (Supabase URL, anon key, service key, `CRON_SECRET`). Preview deploy first.
- [ ] **Ask HUMAN on the board, then** production deploy. Repeat the e2e checks against the live URL: guest play with no Supabase vars, `/status` lists every service, "Barnard's Star" resolves, `/play?ra=&dec=` restores, scoreboard collapses and expands, Inspect shows `[LOCKED]` before Submit and "(433) Eros" with a distance after, overlay diamonds on Eros after Submit, quick look at WISE 0855 loads (skip if IRSA is down and say so).
- [ ] Post the live URL and the checked BP section 19 list on the board.

## Your unit and e2e tests

scoring | `/api/info?mode=round` never returns name, type, distance, JPL | HEALPix parent math | RLS: anon cannot insert into `finds`, cannot read emails | leaderboard snapshot fallback | `/api/health` partial failure | cron route rejects missing `CRON_SECRET`.

## Done when

The live Vercel URL passes the e2e list, scores are server-side only, the spoiler lock is enforced by the server, the free Supabase project is kept alive by cron, and the board shows the final checklist.
