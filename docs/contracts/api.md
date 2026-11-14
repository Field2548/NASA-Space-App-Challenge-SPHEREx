# Contract: API routes (owner: SERVER)

Version 1.1, 2026-11-15 Bangkok (1.1: server-enforced spoiler lock with a signed cookie, after GAME review of PR #6). Change only through a `contract` issue (coordination 3.5).
Source for behaviour: `docs/BUILD_PROMPT.md` (BP) sections 8.10 to 8.12, 8.14, 8.16, 8.19, 9, 10.
Pixel coordinates, frame numbers and the answer-key shape follow `docs/contracts/field-schema.md` (DATA):
`x`, `y` are 0-based, top-down, pixel centres at integers; frame numbers start at 1.

Routes owned by DATA (`/api/quicklook/*`, `/api/overlay`) are listed in section 12 for completeness only.

## 1. Rules for every route

- JSON in, JSON out (`Content-Type: application/json; charset=utf-8`), except `/api/s3range` (bytes).
- Every input is validated with `zod`. Unknown keys are ignored. Numbers in query strings are parsed with `z.coerce.number()`.
- **Errors** always have this shape, with a matching HTTP status:

```json
{ "error": { "code": "bad_request", "message": "Plain words the UI can show.", "details": {} } }
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | zod validation failed; `details` holds the zod issues |
| 401 | `unauthorized` | a login is required and the token is missing or invalid; also a wrong `CRON_SECRET` |
| 404 | `not_found` | unknown spot slug, or a name Sesame cannot resolve |
| 429 | `rate_limited` | too many calls; `details.retry_after_s` and a `Retry-After` header |
| 502 | `upstream_failed` | an outside service (Sesame, SIMBAD, Gaia, JPL, IRSA) failed after retries; `details.service` names it |
| 503 | `db_unavailable` | Supabase is not configured or not answering, for a route that cannot work without it |
| 500 | `internal` | anything else |

- **Login.** Supabase Auth runs in the browser. A logged-in call sends `Authorization: Bearer <supabase access token>`. No header = guest. Guests can call every route; routes that write to the database answer as noted per route.
- **No database is a normal state** (issue #3 item 1 default). Each route below says what it does without one. Nothing crashes.
- **Rate limit:** light, per IP, in memory. About 30 calls per minute for `/api/check`, 60 for the read routes. On Vercel each serverless instance counts on its own, so this is best effort only: it slows a runaway loop, it is not a security control.
- **Points and verdicts are computed only on the server.** The client never sends points and never reads an answer key. Nothing under `web/data/` is ever served.

## 2. The spoiler rule: `mode=round|explore`

Used by `/api/info` (and DATA's `/api/overlay`).

| `mode` | When the client sends it | What the server returns |
| --- | --- | --- |
| `round` | a tutorial level, or play before Submit | **no names, types, spectral types, distances, parallaxes, redshifts, JPL results or links.** Those keys are absent from the JSON, not `null`. |
| `explore` | after Submit on that spot, in free explore, on the sky map, in quick look | everything, if the server grants it (see below) |

- A missing or unknown `mode` is treated as `round` (the safe side).
- **The server decides, not the client** (BP section 3: "The server enforces this"). Asking for `mode=explore` is only a request:
  - For a **ready spot** (a call with `spot=`, or `ra`/`dec` inside a ready spot's picture), the server answers as `explore` only if this player has submitted on that spot. Otherwise it answers exactly as `round`, with `"mode": "round", "locked": true`. Always read `locked` from the response; never assume.
  - For a position **outside every ready spot** (sky map, quick look), `explore` is always granted.
- **How the server knows you submitted:** every `/api/check` and `/api/complete` answer sets a cookie `unlock` (`HttpOnly`, `SameSite=Lax`, `Secure` on https, `Path=/api`, 30 days). It holds the list of unlocked spot slugs, signed with HMAC-SHA256 by a server secret, so it cannot be forged or edited. A logged-in player with a saved visit to the spot is also unlocked, on any device. Works for guests and with no database.
  - Client: call the API with `credentials: "same-origin"` (the `fetch` default). Nothing else to do; the cookie is not readable from JavaScript.
  - Secret: `UNLOCK_SECRET`; if unset, a key derived from `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`; if none is set (local development), a random key per server process, so a restart locks spots again until the next submit.
  - `/embed` inside another site's page does not receive the cookie (`SameSite=Lax`), so embedded views stay locked.
- The client switches a spot's UI from locked to unlocked after `/api/check` answered with `"unlocked": true`.
- The lock is tested on the JSON, not on loose substrings: a locked response has exactly the keys `mode`, `locked`, `position`, and its text contains neither `Eros` nor `433`.

## 3. `POST /api/check`

Check a submission against the private answer key. Works with no database (returns points, saves nothing).

Request:

```json
{ "spot": "eros",
  "answer": "track",
  "marks": [ { "frame": 1, "x": 51.0, "y": 64.0 }, { "frame": 3, "x": 55.5, "y": 62.5 } ] }
```

```json
{ "spot": "cygnus", "answer": "nothing" }
```

```ts
const Mark = z.object({ frame: z.number().int().min(1), x: z.number().finite(), y: z.number().finite() });
const CheckBody = z.discriminatedUnion("answer", [
  z.object({ spot: z.string().regex(/^[a-z0-9-]{1,40}$/), answer: z.literal("track"),
             marks: z.array(Mark).min(2).max(32) }),
  z.object({ spot: z.string().regex(/^[a-z0-9-]{1,40}$/), answer: z.literal("nothing") }),
]);
```

- `marks` are the player's clicks: one per frame at most, in at least 2 different frames. The server fits the track itself from the marks and the frame times in `field.json`; it does not trust a client velocity.
- One call checks one track. For two movers in a spot, call twice.

Response `200`:

```json
{ "verdict": { "kind": "known",
               "object_name": "433 Eros (A898 PA)",
               "points": 150,
               "message": "Confirmed: 433 Eros (A898 PA), asteroid." },
  "first_finder": true,
  "already_found": false,
  "persisted": false,
  "unlocked": true,
  "reveal": { "frame": 1, "x": 51.2, "y": 63.9 },
  "track": { "x0": 51.0, "y0": 64.0, "vx": 12.1, "vy": -3.4, "rms": 0.2, "rate_arcsec_per_hour": 3.2 },
  "noise_bar_sigma": null }
```

`verdict` is the `Verdict` type in `web/lib/types.ts`:

| `kind` | Meaning | `object_name` | Points |
| --- | --- | --- | --- |
| `known` | the marks are within 2 px of a known object's answer-key position in at least 2 frames | the object's name | yes |
| `bot_match` | no known object, but the track matches a bot candidate that is above the noise bar: position within 2 px in each marked frame, velocity within 2 px/day | absent | yes |
| `candidate` | moves, matches nothing. "Unconfirmed candidate." | absent | 0 |
| `static` | the fitted motion over the marked frames is under 1 px. "That one didn't move; it's a star." | absent | 0 |
| `nothing_correct` | answered "nothing" and the key has `nothing_moves: true` | absent | yes |
| `nothing_wrong` | answered "nothing" but something moves here | absent (no spoiler) | 0 |

The checks run in the order of the table, and the first that fits wins. So a slow known object (Eris moves about 1.7 px between frames) marked in two close frames is `known`, not `static`: `known` is tested before the 1 px motion rule.

For `bot_match`, the bot's position in a marked frame is `x + vx * (mjd_frame - t_ref_mjd)` from the answer key. When the marked frames are close in time, the velocity tolerance widens to `4 px / time span`, because two marks that are each within 2 px of the path cannot pin the speed down better than that.

Other keys:

| Key | Meaning |
| --- | --- |
| `verdict.points` | integer, final, already includes the first-finder bonus. 0 when `already_found`. |
| `verdict.message` | one plain sentence for the UI. For `bot_match` it always carries the numbers: "Matches the bot: 6.9σ against a 5.9σ noise bar." |
| `first_finder` | `true` if no other player found this object before. Always `false` for guests and with no database. |
| `already_found` | this player already has this object in this spot; no points the second time |
| `persisted` | `true` if a row was written to `finds`. `false` for guests and with no database: the client then keeps the result in localStorage. |
| `unlocked` | `true` after any submission: the spot's spoiler lock is off for this player. The same response sets the signed `unlock` cookie (section 2). |
| `reveal` | where to open Inspect as the reward (answer-key position of the found object). Present only for `known`. |
| `track` | the server's fit: `x0, y0` at the first marked frame's time, `vx, vy` in px/day, `rms` in px. Absent for `answer: "nothing"`. |
| `noise_bar_sigma` | the spot's noise bar, or `null` when no bot search was run. Never show a bot match without it. |

Points (BP 8.10): easy 100, medium 250, hard 500, boss 1000, expert 750; first finder +50 percent, rounded.
SERVER decisions where BP is silent, object within 20 minutes on the board if you disagree:
`control` spots (Cygnus) give 250 for `nothing_correct`; `bot_match` gives the spot's full points; `fixture` is scored as easy.
Accuracy = (`known` + `bot_match` + `nothing_correct`) / all submissions.

Quick-look marks (phase 4, draft): same route with `"spot": "quicklook"` plus `"field": { "ra", "dec", "fov_deg", "size", "frames": [{ "i", "mjd" }] }`. The server runs JPL `sb_ident`, answers `known` (with the name, **0 points**) or `candidate`. Final shape comes with a `contract` issue before 16:00.

Errors: `404 not_found` (unknown spot), `400 bad_request` (fewer than 2 frames marked, a frame number the spot does not have).

## 4. `POST /api/complete`

Mark spots as checked and move guest progress into an account. Login required (`401` for guests, `503` with no database).

```json
{ "replay": [ { "spot": "eros", "answer": "track", "marks": [ { "frame": 1, "x": 51, "y": 64 }, { "frame": 3, "x": 55.5, "y": 62.5 } ] },
              { "spot": "cygnus", "answer": "nothing" } ] }
```

- `replay` holds the guest's saved `/api/check` request bodies (1 to 20). The server checks each again and saves them, so guest points are also computed on the server.
- Response: `{ "results": [ <one /api/check response per entry> ], "total_points": 400 }`.

## 5. `GET /api/resolve?name=`

Name to coordinates through CDS Sesame. Cached for 1 day.

`name`: 1 to 80 characters. Response `200`:

```json
{ "name": "Barnard's Star", "ra": 269.4520769, "dec": 4.6933649, "frame": "ICRS J2000", "source": "CDS Sesame" }
```

`404 not_found` if Sesame has no position. `502 upstream_failed` if Sesame does not answer.

## 6. `GET /api/info?spot=&x=&y=&ra=&dec=&mode=round|explore`

Catalog facts for the Inspect popup, sections D, E, G. Sections A, B, C, F need no server.

- Ready spot: send `spot`, `x`, `y`. The server reads `web/data/catalog/<slug>.json` (no network).
- Anywhere else (sky map, quick look): send `ra`, `dec` in degrees. The server asks SIMBAD TAP, Gaia TAP and JPL in parallel, 8 s each. Partial results are fine. Cached by position rounded to 1 arcsec.
- Radii (BP 8.16): SIMBAD objects within 9 arcsec, nearest Gaia source within 6 arcsec, solar-system objects within 2 px at any frame time.

`mode=explore` response:

```json
{ "mode": "explore", "locked": false,
  "position": { "ra": 13.2004, "dec": 14.38, "x": 51, "y": 64 },
  "sources": { "simbad": "ok", "gaia": "ok", "jpl": "ok" },
  "simbad": [ { "name": "HD 5112", "otype": "*", "sp_type": "M0III", "z": null, "sep_arcsec": 2.1,
                "url": "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=HD%205112" } ],
  "gaia": { "id": "Gaia DR3 2590311523446772736", "g_mag": 15.2, "plx": 2.1, "plx_over_err": 14.2,
            "pmra": 12.3, "pmdec": -4.5, "sep_arcsec": 0.8 },
  "solar_system": [ { "name": "433 Eros (A898 PA)", "frame": 1, "sep_px": 0.4,
                      "r_au": 1.45, "delta_au": 0.62, "source": "JPL Horizons" } ],
  "links": [ { "label": "SIMBAD", "url": "https://simbad.cds.unistra.fr/..." },
             { "label": "IRSA Spectrophotometry Tool", "url": "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry" } ] }
```

`mode=round` response, complete:

```json
{ "mode": "round", "locked": true, "position": { "ra": 13.2004, "dec": 14.38, "x": 51, "y": 64 } }
```

- `sources.*` is one of `ok`, `premade` (from the catalog file), `empty` (asked, nothing there), `timeout`, `error`, `skipped`. The popup says which source failed.
- `gaia` is `null` when nothing is within 6 arcsec. `simbad` and `solar_system` are `[]` when empty.
- `r_au`, `delta_au` are present only when JPL Horizons gave them (ready-spot objects). Never estimated.
- The server returns catalog values only. Distances in light-years, light-minutes or from redshift are worked out in the popup with DATA's `parallaxDistance` and `redshiftDistance` (BP 8.16 rules), so each number keeps its source.
- A spot with no catalog file yet answers `sources: { "simbad": "skipped", ... }` and empty lists, not an error.

## 7. `GET /api/leaderboard?scope=spot|all&slug=`

`slug` is required when `scope=spot`. Never returns emails or user ids. A logged-in call also gets `me`.

```json
{ "scope": "all", "slug": null, "source": "db", "updated_at": "2026-11-15T09:30:00Z",
  "rows": [ { "rank": 1, "name": "nova", "score": 1850, "accuracy": 0.83, "is_bot": false, "is_me": false },
            { "rank": 2, "name": "Shift-and-stack bot", "score": 1000, "accuracy": 1, "is_bot": true, "is_me": false } ],
  "me": { "rank": 14, "name": "kt", "score": 350, "accuracy": 0.5 } }
```

- Top 50 rows. `accuracy` is 0 to 1, or `null` with no submissions. `me` is absent for guests.
- The bot row is scored from the bot's candidates that match known objects, and is always labelled as a bot.
- `source` is `db`, or `snapshot` when Supabase is missing or down: the route then serves `web/public/leaderboard-snapshot.json` (same shape) with status 200.

## 8. `GET /api/density?layer=finds|checked&order=&who=me|all`

HEALPix NESTED cell counts for the sky map. `order` is an integer 0 to 12 (default 4). `who=me` needs a login (`401` otherwise).

```json
{ "layer": "finds", "order": 4, "who": "all", "source": "db", "max": 12, "cells": [ [1203, 12], [77, 3] ] }
```

`cells` is a list of `[ipix, count]`, only cells with count above 0. With no database: `source: "none"`, `cells: []`, status 200.

## 9. `POST /api/request-spot` and `GET /api/request-spot`

`POST` body `{ "ra": 133.795, "dec": -7.245, "fov": 0.2 }` (`ra` 0 to 360, `dec` -90 to 90, `fov` 0.05 to 0.5 degrees). Guests may ask.
Response `201`: `{ "id": 17, "status": "queued" }`. With no database: `503 db_unavailable`.

`GET` lists the queue for `/requests`, newest first, at most 100:
`{ "requests": [ { "id": 17, "ra": 133.795, "dec": -7.245, "fov": 0.2, "status": "queued", "created_at": "2026-11-15T09:30:00Z" } ] }`.
`status` is `queued`, `processing`, `done` or `failed`. With no database: `{ "requests": [], "source": "none" }`.

## 10. `GET /api/health`

Checks every outside service in parallel, 5 s each, cached 60 s. Always `200`.

```json
{ "checked_at": "2026-11-15T09:30:00Z", "overall": "amber",
  "services": [ { "id": "irsa_sia", "name": "IRSA image search", "status": "red", "ms": 5000, "http": null,
                  "message": "IRSA is not answering right now. Ready spots still work; quick look may fail." } ] }
```

- `id` is one of `irsa_sia`, `irsa_s3`, `cds_sesame`, `cds_hips`, `simbad_tap`, `gaia_tap`, `jpl_horizons`, `jpl_sbident`, `supabase`.
- `status`: `green` (answered under 2 s), `amber` (slow, or not configured), `red` (failed or timed out). `overall` is the worst one, but `supabase` not configured counts as `amber`, never `red`.

## 11. `GET /api/keepalive` and `GET /api/s3range?key=`

- `/api/keepalive`: Vercel Cron calls it once a day with `Authorization: Bearer <CRON_SECRET>`. Wrong or missing secret: `401`. Response `{ "ok": true, "db": "ok" }` (`"not_configured"` with no database).
- `/api/s3range`: built **only if** DATA's day-one check shows the browser cannot read the S3 bucket directly. Passes the `Range` header through to `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/<key>` and returns the bytes with `206`. `key` must match `^[A-Za-z0-9._/-]+\.fits$`, no `..`; one range per call, at most 4 MB. No other bucket or host is reachable through it.

## 12. Routes owned by DATA (not defined here)

`GET /api/quicklook/list?ra=&dec=` and `GET /api/overlay?spot=|ra=&dec=&mjd=...&mode=`. They follow section 1 (error shape) and section 2 (`/api/overlay?mode=round` returns nothing). DATA publishes their JSON.

## 13. Client helpers and environment (SERVER provides)

```ts
// web/lib/supabase.ts
getSupabaseBrowser(): SupabaseClient | null      // null when the env vars are missing: guest mode only
authHeader(): Promise<Record<string, string>>    // { Authorization: "Bearer ..." } or {} for guests
```

| Env var | Where | Needed for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser and server | login, reads |
| `SUPABASE_SERVICE_ROLE_KEY` | server only, never `NEXT_PUBLIC_` | writing `finds`, `visits` |
| `CRON_SECRET` | server only | `/api/keepalive` |
| `UNLOCK_SECRET` | server only, optional | signing the `unlock` cookie (section 2) |

All of them missing = guest mode: `/api/check` scores from the answer key, the scoreboard shows the snapshot, the density layers are empty.
