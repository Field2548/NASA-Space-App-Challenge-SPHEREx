# Contract: API routes (owner: SERVER)

Version 1.3, 2026-11-15 Bangkok. Change only through a `contract` issue (coordination 3.5).
Source for behaviour: `docs/BUILD_PROMPT.md` (BP) sections 8.10 to 8.12, 8.14, 8.16, 8.19, 9, 10.
Pixel coordinates, frame numbers and the answer-key shape follow `docs/contracts/field-schema.md` (DATA):
`x`, `y` are 0-based, top-down, pixel centres at integers; frame numbers start at 1.

**Changes in 1.3** (2026-11-15, after a second adversarial review):

- **Edge guard band** (section 6): a position within `ceil(9 arcsec / pixel_arcsec) + 1` px of a ready spot's picture (3 px for 6.15 arcsec pixels) on any side counts as inside the spot, so the live SIMBAD and Gaia lookups can no longer return a star that lies inside a locked picture.
- **Practice from visits for logged-in players** (section 3): with a login and a database, `practice` follows saved visits only, never the unlock cookie, so a guest session's cookie no longer costs a new account its points. Guests and no-database calls still use the cookie.
- **Shared budget charged after login** (section 4): `/api/complete` charges the shared `/api/check` budget only after the 503 and 401 checks, so anonymous calls cannot drain a player's budget. Rate-limit address order and eviction are described in section 1.
- **Request de-duplication** (section 9): `POST /api/request-spot` returns the existing request when one lies within 0.05 degrees (`200`, `duplicate: true`) and answers `429` when 200 requests are queued. Database: repeated `candidate`/`static` rows are not counted and a player has at most 50 `finds` rows per spot (section 8, migration).

**Changes in 1.2** (2026-11-15, after an independent adversarial review of the SERVER code):

- Only a **correct** answer unlocks a spot. Wrong answers leave it locked, so the player can try again (section 2).
- Answers on a spot that is already open are still judged but earn 0 points, with `"practice": true` (section 3).
- `bot_match` now earns **0 points** (it was full points). A bot candidate that is a known object now scores as that object (`known`), so one object cannot be scored twice (section 3).
- Check order is now `known`, `bot_match`, `static`, `candidate`. The separate bot velocity tolerance is gone (section 3).
- Marks must be finite and at most 2 px outside the picture (section 3). Request bodies are limited to 64 kB by `Content-Length` and by bytes (section 1).
- `UNLOCK_SECRET` is **required** in production. Without it no cookie is signed and `/api/health` carries a warning (sections 2, 10, 13).
- `density` gains `who=others`. The Finds layer stores the spot centre, never the mover's position (section 8).
- Database: `find_key` and `counted` columns, display-name rules, and a `p_who` form of `density` (sections 3, 7, 8, and the migration).
- Smaller fixes: `0 ≤ ra < 360` (section 9), `/api/keepalive` without `CRON_SECRET` (section 11), the JPL `sb_ident` observer (section 3), and a request/response example that matches the real Eros data (section 3).

Routes owned by DATA (`/api/quicklook/*`, `/api/overlay`) are listed in section 12 for completeness only.

## 1. Rules for every route

- JSON in, JSON out (`Content-Type: application/json; charset=utf-8`), except `/api/s3range` (bytes).
  A JSON request body is parsed whatever its `Content-Type` header says. A wrong HTTP method on a route answers 405 with an empty body (Next's default), and an unknown `/api/...` path answers Next's HTML 404 page, not the error shape above.
- Every input is validated with `zod`. Unknown keys are ignored. Numbers in query strings are parsed with `z.coerce.number()`.
- JSON bodies are limited to 64 kB: refused when `Content-Length` says more, and again when the body itself is more than 64,000 bytes in UTF-8 (`400 bad_request`, "That request is too large.").
- **Errors** always have this shape, with a matching HTTP status:

```json
{ "error": { "code": "bad_request", "message": "Plain words the UI can show.", "details": {} } }
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | zod validation failed (`details` holds the zod issues), or marks the scorer refuses |
| 401 | `unauthorized` | a login is required and the token is missing or invalid; also a wrong or unset `CRON_SECRET` |
| 404 | `not_found` | unknown spot slug, or a name Sesame cannot resolve |
| 429 | `rate_limited` | too many calls; `details.retry_after_s` and a `Retry-After` header |
| 502 | `upstream_failed` | an outside service (Sesame, SIMBAD, Gaia, JPL, IRSA) failed after retries; `details.service` names it |
| 503 | `db_unavailable` | Supabase is not configured or not answering, for a route that cannot work without it |
| 500 | `internal` | anything else, including a ready spot whose answer key or `field.json` the server cannot read |

- **Login.** Supabase Auth runs in the browser. A logged-in call sends `Authorization: Bearer <supabase access token>`. No header = guest. Guests can call every route; routes that write to the database answer as noted per route.
- **No database is a normal state** (issue #3 item 1 default). Each route below says what it does without one. Nothing crashes.
- **Rate limit:** light, per IP, in memory. About 30 calls per minute for `/api/check`, 60 for the read routes. The address is `x-vercel-forwarded-for` (first entry), else `x-real-ip`, else the last `x-forwarded-for` entry (added by the nearest proxy; the first entry is written by the client), else `local`. When the in-memory table is full it drops the roughly 10% of addresses whose window ends soonest, never all of them. On Vercel each serverless instance counts on its own, so this is best effort only: it slows a runaway loop, it is not a security control.
- **Points and verdicts are computed only on the server.** The client never sends points and never reads an answer key. Nothing under `web/data/` is ever served.

## 2. The spoiler rule: `mode=round|explore`

Used by `/api/info` (and DATA's `/api/overlay`).

| `mode` | When the client sends it | What the server returns |
| --- | --- | --- |
| `round` | a tutorial level, or play before a correct answer | **no names, types, spectral types, distances, parallaxes, redshifts, JPL results or links.** Those keys are absent from the JSON, not `null`. |
| `explore` | after a correct answer on that spot, on the sky map outside ready spots, in quick look | everything, if the server grants it (see below) |

- A missing `mode` (or an empty one, `mode=`) is treated as `round`. Any other value than `round` or `explore` answers `400 bad_request`.
- **The server decides, not the client** (BP section 3: "The server enforces this"). Asking for `mode=explore` is only a request:
  - For a **ready spot** (a call with `spot=`, or `ra`/`dec` inside a ready spot's picture), the server answers as `explore` only if this player has a **correct** answer on that spot (`known`, `bot_match` or `nothing_correct`). Otherwise it answers exactly as `round`, with `"mode": "round", "locked": true`. Always read `locked` from the response; never assume.
  - For a position **outside every ready spot** (sky map, quick look), `explore` is always granted.
- **SERVER decision (differs from BP 3 and 8.16, "always open in free explore and on the sky map"):** a ready spot stays locked on the sky map and in free explore too, until the player has a correct answer there. Reason: otherwise one click on the sky map shows the answer to every ready spot before it is played.
- **Wrong answers do not unlock.** `candidate`, `static` and `nothing_wrong` leave the spot locked and answer `"unlocked": false`, so the player can try again.
- **How the server knows:** a correct `/api/check` answer (and a correct entry in `/api/complete`) sets a cookie `unlock` (`HttpOnly`, `SameSite=Lax`, `Secure` on https, `Path=/api`, 30 days). It holds the list of unlocked spot slugs, signed with HMAC-SHA256 by a server secret, so it cannot be forged or edited. Later, a logged-in player with a saved visit to the spot is also unlocked, on any device (a visit is saved only with a correct answer, the same moment the cookie is set). Works for guests and with no database.
  - Client: call the API with `credentials: "same-origin"` (the `fetch` default). Nothing else to do; the cookie is not readable from JavaScript.
  - Secret, in this order: `UNLOCK_SECRET`; else a key derived from `CRON_SECRET`; else one derived from `SUPABASE_SERVICE_ROLE_KEY`. **Adding or changing any of these invalidates every unlock cookie already handed out** (players see their finished spots locked until their next correct answer). Set `UNLOCK_SECRET` once and leave it.
  - **`UNLOCK_SECRET` is REQUIRED in production.** In production with none of the three set, the server signs nothing: no cookie is set, every cookie reads as empty, `/api/check` answers `"unlocked": false`, the server logs one `console.error`, and `/api/health` carries a warning (section 10). Outside production with none set (local development), a random key per server process is used, so a restart locks spots again.
  - `/embed` inside another site's page does not receive the cookie (`SameSite=Lax`), so embedded views stay locked.
- **Once a spot is open for this player, it is practice.** Further `/api/check` answers on it are judged as usual but earn **0 points**, with `"practice": true` (section 3); who counts as "open" for points is decided there.
- **What the lock does and does not stop:** it prevents spoilers and casual cheating, but a determined player with two browsers can still look an answer up in one and submit it in the other.
- The client switches a spot's UI from locked to unlocked after `/api/check` answered with `"unlocked": true`.
- The lock is tested on the JSON, not on loose substrings: a locked response has exactly the keys `mode`, `locked`, `position`, and its text contains neither `Eros` nor `433`.

## 3. `POST /api/check`

Check a submission against the private answer key. Works with no database (returns points, saves nothing).

Request (marks on Eros in frames 1 and 3, rounded to whole pixels like clicks):

```json
{ "spot": "eros",
  "answer": "track",
  "marks": [ { "frame": 1, "x": 84, "y": 79 }, { "frame": 3, "x": 40, "y": 43 } ] }
```

```json
{ "spot": "cygnus", "answer": "nothing" }
```

```ts
const Coord = z.number().finite().min(-64).max(4096);
const Mark = z.object({ frame: z.number().int().min(1), x: Coord, y: Coord });
const CheckBody = z.discriminatedUnion("answer", [
  z.object({ spot: z.string().regex(/^[a-z0-9-]{1,40}$/), answer: z.literal("track"),
             marks: z.array(Mark).min(2).max(32) }),
  z.object({ spot: z.string().regex(/^[a-z0-9-]{1,40}$/), answer: z.literal("nothing") }),
]);
```

- `marks` are the player's clicks: one per frame at most, in at least 2 different frames. The server fits the track itself from the marks and the frame times in `field.json`; it does not trust a client velocity.
- After zod, the scorer refuses (`400 bad_request`) a mark more than 2 px outside the picture: `x` must be in `-2 .. W+1` and `y` in `-2 .. H+1` for `size: [W, H]`. Every number in `track` is finite.
- One call checks one track. For two movers in a spot, call twice.

Response `200` for the request above, as a guest with no database, before the spot was open (the real output; `track` numbers shortened here):

```json
{ "verdict": { "kind": "known",
               "object_name": "433 Eros (A898 PA)",
               "points": 100,
               "message": "Confirmed: 433 Eros (A898 PA), asteroid." },
  "first_finder": false,
  "already_found": false,
  "persisted": false,
  "unlocked": true,
  "practice": false,
  "reveal": { "frame": 1, "x": 83.56, "y": 78.71 },
  "track": { "x0": 84, "y0": 79, "vx": -216.90, "vy": -177.46, "rms": 0, "rate_arcsec_per_hour": 71.81 },
  "noise_bar_sigma": null }
```

The example above has no `spot_reveal`: today's Eros answer key has no `reveal` block, so the server adds nothing. Once DATA's keys carry one, the same open response adds `"spot_reveal": { "title": ..., "kind": ..., "difficulty": ... }`.

`verdict` is the `Verdict` type in `web/lib/types.ts`. **The checks run in the order of this table, and the first that fits wins:**

| Order | `kind` | Meaning | `object_name` | Points |
| --- | --- | --- | --- | --- |
| 1 | `known` | the marks are within 2 px of a known object's answer-key position in at least 2 frames; **or** they follow a bot candidate that is a known object (below) | the object's name | yes |
| 2 | `bot_match` | the marks follow a bot candidate that is above the noise bar and is no known object | absent | **0** |
| 3 | `static` | the fitted motion over the marked frames is under 1 px. "That one didn't move; it's a star." | absent | 0 |
| 4 | `candidate` | moves, matches nothing. "Unconfirmed candidate." | absent | 0 |
| - | `nothing_correct` | answered "nothing" and the key has `nothing_moves: true` | absent | yes |
| - | `nothing_wrong` | answered "nothing" but something moves here | absent (no spoiler) | 0 |

- `known` and `bot_match` are tested before the 1 px motion rule, so a slow mover marked in two close frames is never called a star. Eris (about 1.7 px between frames) is `known`; a slow bot candidate is `bot_match`.
- **Following a bot candidate** means: in every marked frame, the mark is within 2 px of the candidate's predicted position `x + vx * (mjd_frame - t_ref_mjd)` (same for `y`) from the answer key, in at least 2 frames. There is **no separate velocity check** (removed in 1.2): marks on the path in every marked frame already fix the velocity.
- **A bot candidate "is" a known object** when its predicted path is within **3 px** of that object's `in_grid` answer positions in at least 2 frames (3 px, not 2: the bot's straight-line path for Hektor is up to 2.5 px from JPL's positions). Marks that follow such a candidate get `known` for that object: same name, same points, same `reveal`, never `bot_match`.
- **`bot_match` needs both** `above_noise_bar: true` and `stacked_snr > noise_bar_sigma`, and never happens when `noise_bar_sigma` is `null`. Its message always carries the numbers: "Matches the bot: 6.2σ against a 5.9σ noise bar. Not a confirmed object, so no points."
- **SERVER decision made after the review (replaces 1.1's "bot_match gives full points"):** `bot_match` earns 0 points. It still counts as a correct submission for accuracy and it unlocks the spot. Reason: marginal candidates such as Eris's rank 2 (6.24σ against a 5.9σ bar) paid 1000 points for marking what is most likely noise.
- **Known gap (planned, phase 3):** BP 8.10's third step, "otherwise `sb_ident` checks for a known asteroid", is not done live for ready spots. It will use DATA's pre-made `web/data/catalog/<slug>.json` `asteroids[]` when that file exists (not built yet). Until then such a mark is a `candidate`.

Other keys:

| Key | Meaning |
| --- | --- |
| `verdict.points` | integer, final, already includes the first-finder bonus. 0 when `already_found`, and 0 when `practice`. |
| `verdict.message` | one plain sentence for the UI. With `practice` it ends with " Practice: this spot is already open, so no points." |
| `first_finder` | `true` if no other player found this object before. Always `false` for guests, with no database, for practice, and in quick look. The bonus applies to `known` only. |
| `already_found` | this player already has this find in this spot (same find key, below); no points the second time |
| `persisted` | `true` if a row was written to `finds`. `false` for guests and with no database: the client then keeps the result in localStorage. |
| `unlocked` | `true` when the spot's spoiler lock is now off for this player: after a correct answer, or when it was already open. `false` after a wrong answer, and in production without `UNLOCK_SECRET` (section 2). A correct answer also sets the signed `unlock` cookie. |
| `practice` | `true` when the spot was already open for this player before this call. The answer is judged but earns 0 points. Always present. Who counts as open: see the practice rule below. |
| `reveal` | where to open Inspect as the reward (answer-key position of the found object). Present only for `known`. |
| `track` | the server's fit: `x0, y0` at the first marked frame's time, `vx, vy` in px/day, `rms` in px. Absent for `answer: "nothing"`. |
| `noise_bar_sigma` | the spot's noise bar, or `null` when no bot search was run. Never show a bot match without it. |
| `spot_reveal` | `{ title, kind, difficulty }`: the spot's real title, sent once the spot is open (`unlocked` or `practice` is `true`), never on a wrong answer to a locked spot. Absent until DATA's answer keys carry a `reveal` block. |

**Find key** (server only, never sent): what "the same find" means in a spot, so one thing scores once. `object:<id>` for a known object however it was reached, `bot:<rank>` for a bot candidate that is no known object, `nothing` for `nothing_correct`; none for wrong answers. The route passes it to `record_find(p_find_key)`, which decides `already_found` and the first finder per find key.

**Practice rule.** For a logged-in player with a database, `practice` is true only when they have a saved visit to the spot (`hasVisit`); the unlock cookie lifts the spoiler lock but never costs points, so a spot a guest session unlocked before sign-up still scores once for the new account. For a guest, or with no database, `practice` is true when the signed cookie covers the spot.

Points (BP 8.10): easy 100, medium 250, hard 500, boss 1000, expert 750; first finder +50 percent, rounded, for `known` only.
SERVER decisions where BP is silent, object within 20 minutes on the board if you disagree:
`control` spots (Cygnus) give 250 for `nothing_correct`; `bot_match` gives 0 (above); `fixture` is scored as easy.
Accuracy = (`known` + `bot_match` + `nothing_correct`) / all submissions, both counted over `counted` rows only (section 7).

Quick-look marks (phase 4, draft): same route with `"spot": "quicklook"` plus `"field": { "ra", "dec", "fov_deg", "size", "frames": [{ "i", "mjd" }] }`. The server runs JPL `sb_ident` for a **geocentric observer, `xobs=0,0,0,0,0,0`** (not `mpc-code=500`, which DATA found refused; SPHEREx's low orbit is at most about 7000 km from the Earth's centre, well under a pixel of parallax for anything past the Moon). It answers `known` (with the name, **0 points**) or `candidate`. Quick-look rows never score, are never a first finder and are not counted. Final shape comes with a `contract` issue before 16:00.

Errors: `404 not_found` (unknown spot), `400 bad_request` (fewer than 2 frames marked, a frame number the spot does not have, a frame marked twice, a mark outside the picture), `500 internal` (a spot listed in `web/public/fields/index.json` whose answer key or `field.json` the server cannot read).

## 4. `POST /api/complete`

Mark spots as checked and move guest progress into an account. Login required (`401` for guests, `503` with no database).

```json
{ "replay": [ { "spot": "eros", "answer": "track", "marks": [ { "frame": 1, "x": 84, "y": 79 }, { "frame": 3, "x": 40, "y": 43 } ] },
              { "spot": "cygnus", "answer": "nothing" } ] }
```

- `replay` holds the guest's saved `/api/check` request bodies (1 to 20). The server checks each again and saves them, so guest points are also computed on the server.
- Practice for a replayed entry is true only when the account had a saved visit to the spot before the replay started, or an earlier entry of the same replay already answered that spot correctly; the cookie is never used. `record_find`'s `already_found` (per find key) still stops anything from scoring twice on the account.
- Order of checks: body parse, this route's own limit (5 calls a minute), `503` (no database), `401` (no login), and only then the shared `/api/check` budget: each replayed entry costs one unit of the per-address 30 a minute, so a replay of n entries uses n units, and a replay that would exceed the budget is refused whole with `429` before anything is scored. Calls that fail with 503 or 401 therefore never charge the `/api/check` budget.
- Response: `{ "results": [ <one /api/check response per entry> ], "total_points": 350 }`.

## 5. `GET /api/resolve?name=`

Name to coordinates through CDS Sesame. Cached for 1 day.

`name`: 1 to 80 characters. Response `200`:

```json
{ "name": "Barnard's Star", "ra": 269.4520769, "dec": 4.6933649, "frame": "ICRS J2000", "source": "CDS Sesame" }
```

`404 not_found` if Sesame has no position. `502 upstream_failed` if Sesame does not answer.

## 6. `GET /api/info?spot=&x=&y=&ra=&dec=&mode=round|explore`

Catalog facts for the Inspect popup, sections D, E, G. Sections A, B, C, F need no server.

`mode` is `round` or `explore` (section 2): missing means `round`, and any other value (for example `mode=zz`) answers `400 bad_request`.

- Ready spot: send `spot`, `x`, `y`. The server reads `web/data/catalog/<slug>.json` (no network).
- Anywhere else (sky map, quick look): send `ra`, `dec` in degrees. The server asks SIMBAD TAP and Gaia TAP live, in parallel, 8 s each. Partial results are fine. Cached by position rounded to 1 arcsec, for 10 minutes (30 seconds when a source failed).
- Live lookups are SIMBAD and Gaia only. JPL is `skipped` for a position without a time, since there is nothing to ask. A round answer outside ready spots makes no network call.
- **Guard band.** The picture covers pixel coordinates `-0.5 <= x < W-0.5` (centres at integers). A position within `ceil(9 arcsec / pixel_arcsec) + 1` px (3 px for 6.15 arcsec pixels) of the picture on any of the four sides is treated as inside that ready spot: it is answered locked unless the cookie covers the spot, and then from the pre-made catalog at the nearest picture pixel (the response echoes the position asked). No live lookup is ever made for a position inside any ready spot's band, because a 9 arcsec SIMBAD cone (1.46 px) there could return a star inside the locked picture.
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
- **Built against the real `web/data/catalog/<slug>.json` (1.2 addendum, SERVER):** the files differ from the field-schema section 9 draft in these ways, and the server follows the real files:
  - A top-level `sources` block (`sources.simbad`, `sources.gaia`, `sources.jpl`). A source block that the file marks `"unavailable"` (SIMBAD, in every file so far: CDS was down) answers `error`. A source the file lacks answers `skipped`. Otherwise `premade` when the file has something near the pixel, `empty` when the file has the source and nothing is near. A `"timeout"` status answers `timeout`.
  - `objects[]` has `id`, `name`, `source` (no `kind`, no `positions`). Its `r_au` and `delta_au` are one value per frame; the entry takes the value for its frame. The per-frame pixel positions come from `asteroids[]`, matched by name.
  - `stars[].xy` is one `[x, y]` per frame. A Gaia distance uses the smallest pixel distance over the frames, times `pixel_arcsec` from `field.json`. A star without `xy` uses its sky position.
  - `spot_reveal` comes from the answer key's `reveal` block, as above. Nothing on the sky-map (outside-spot) path reads a catalog file.

## 7. `GET /api/leaderboard?scope=spot|all&slug=`

`slug` is required when `scope=spot`. A slug that is not a ready spot (not in `web/public/fields/index.json`; the test-only `fixture` excepted) answers `404 not_found`. Never returns emails or user ids. A logged-in call also gets `me`.

```json
{ "scope": "all", "slug": null, "source": "db", "updated_at": "2026-11-15T09:30:00Z",
  "rows": [ { "rank": 1, "name": "nova", "score": 1850, "accuracy": 0.83, "is_bot": false, "is_me": false },
            { "rank": 2, "name": "Shift-and-stack bot", "score": 1750, "accuracy": 0.5, "is_bot": true, "is_me": false } ],
  "me": { "rank": 14, "name": "kt", "score": 350, "accuracy": 0.5 } }
```

- Top 50 rows. `accuracy` is 0 to 1, or `null` with no counted submissions. `me` is absent for guests.
- Accuracy counts only `counted` rows: a repeat of a find the player already has, a practice answer, and quick-look marks do not move it. Every wrong answer counts.
- The bot row is scored from the bot's candidates that match known objects, and is always labelled as a bot. Display names `bot` and `Shift-and-stack bot` (any case) are reserved; the database refuses them.
- The route calls the `leaderboard` RPC **with the caller's token** (anon key client plus the caller's `Authorization` header), never with the service role: the function uses `auth.uid()` for `is_me` and `me`.
- `source` is `db`, or `snapshot` when Supabase is missing or down: the route then serves `web/public/leaderboard-snapshot.json` (same shape) with status 200.

## 8. `GET /api/density?layer=finds|checked&order=&who=me|others|all`

HEALPix NESTED cell counts for the sky map. `order` is an integer 0 to 12 (default 4). `who` defaults to `all`. `who=me` (only the caller's rows) and `who=others` (all rows minus the caller's) need a login (`401` otherwise).

```json
{ "layer": "finds", "order": 4, "who": "all", "source": "db", "max": 12, "cells": [ [1203, 12], [77, 3] ] }
```

`cells` is a list of `[ipix, count]`, only cells with count above 0. With no database: `source: "none"`, `cells: []`, status 200.

- **Where a find is placed (privacy of answers):** a find on a ready spot is stored with the **spot centre** as `ra`, `dec`, `hpx12`, never the mover's position, so the Finds layer cannot point at an answer. Quick-look candidates store the marked position.
- A repeat by the same player of a `candidate` or `static` verdict on the same spot is not `counted`, and a player has at most 50 `finds` rows per spot: past that, `record_find` inserts nothing and reports `already_found: true` with 0 points.
- The Finds layer counts only `counted` rows of kind `known`, `bot_match`, `candidate`. Quick-look rows are not counted (section 3), so for now quick-look candidates do not appear in it; their marked position is kept for a later layer. The Checked layer counts one visit per player per spot, saved with the first correct answer there.
- The route calls the `density` RPC **with the caller's token**, never with the service role (the function uses `auth.uid()` for `me` and `others`). The database function is `density(p_layer, p_order, p_who)` with `p_who` = `'me' | 'others' | 'all'`; the 1.1 form `density(p_layer, p_order, p_mine boolean)` still works as a thin wrapper (`p_mine` true = `me`).

## 9. `POST /api/request-spot` and `GET /api/request-spot`

`POST` body `{ "ra": 133.795, "dec": -7.245, "fov": 0.2 }` (`0 ≤ ra < 360`, `-90 ≤ dec ≤ 90`, `0.05 ≤ fov ≤ 0.5` degrees). Guests may ask.
Response `201`: `{ "id": 17, "status": "queued" }`. With no database: `503 db_unavailable`.

De-duplication and the queue limit (database function `request_spot(p_user, p_ra, p_dec, p_fov)`, service role only):

- A request within 0.05 degrees (a box: dec difference, and RA difference times cos(dec)) of one that is `queued`, `processing` or `done` inserts nothing and answers `200 { "id": 9, "status": "processing", "duplicate": true }` with the existing row.
- With 200 requests already `queued` a new one is refused: `429 rate_limited` with a plain message. Duplicates are still answered when the queue is full.

`GET` lists the queue for `/requests`, newest first, at most 100 (a SERVER addition to BP 8.14, which only asks for the page):
`{ "requests": [ { "id": 17, "ra": 133.795, "dec": -7.245, "fov": 0.2, "status": "queued", "created_at": "2026-11-15T09:30:00Z" } ] }`.
`status` is `queued`, `processing`, `done` or `failed`. With no database: `{ "requests": [], "source": "none" }`.

## 10. `GET /api/health`

Checks every outside service in parallel, 5 s each, cached 60 s. Always `200`.

```json
{ "checked_at": "2026-11-15T09:30:00Z", "overall": "amber",
  "services": [ { "id": "irsa_sia", "name": "IRSA image search", "status": "red", "ms": 5000, "http": null,
                  "message": "IRSA is not answering right now. Ready spots still work; quick look may fail." } ],
  "warnings": [ "UNLOCK_SECRET is not set: finished spots will lock again." ] }
```

- `id` is one of `irsa_sia`, `irsa_s3`, `cds_sesame`, `cds_hips`, `simbad_tap`, `gaia_tap`, `jpl_horizons`, `jpl_sbident`, `supabase`.
- `status`: `green` (answered under 2 s), `amber` (slow, or not configured), `red` (failed or timed out). `overall` is the worst one, but `supabase` not configured counts as `amber`, never `red`.
- `warnings` (optional, added in 1.2): problems in our own setup that are not an outside service, as plain sentences for the status page. Absent when there are none. Today the only one is `"UNLOCK_SECRET is not set: finished spots will lock again."`, in production when no secret signs the unlock cookie (section 2). Warnings do not change `overall`.
- `configured` (optional, added in 1.2): `false` only for `supabase` when no database URL is set (its `status` is then `amber` and clients show "Not connected" with no time); it is omitted for every other service.
- The `jpl_sbident` probe asks for numbered comets in a 0.01 degree field for a geocentric observer (`xobs=0,0,0,0,0,0`): about 0.7 s. The all-asteroid search of a 0.1 degree field took about 18 s, longer than the 5 s probe.

## 11. `GET /api/keepalive` and `GET /api/s3range?key=`

- `/api/keepalive`: Vercel Cron calls it once a day with `Authorization: Bearer <CRON_SECRET>`. Wrong or missing secret: `401`. When `CRON_SECRET` itself is not set, every call answers `401` (nobody can trigger it). Response `{ "ok": true, "db": "ok" }` (`"not_configured"` with no database).
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
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser and server | login, reads (`leaderboard`, `density` with the caller's token) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only, never `NEXT_PUBLIC_` | writing `finds`, `visits` (`record_find`) |
| `CRON_SECRET` | server only | `/api/keepalive` (unset = always `401`) |
| `UNLOCK_SECRET` | server only, **REQUIRED in production** | signing the `unlock` cookie (section 2). Set it once: adding or changing it, `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` while one of them signs the cookie invalidates every cookie already handed out. |

All of them missing = guest mode: `/api/check` scores from the answer key, the scoreboard shows the snapshot, the density layers are empty. In production, set at least `UNLOCK_SECRET`, or spots never unlock.
