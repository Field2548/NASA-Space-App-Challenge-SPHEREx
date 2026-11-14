# Build prompt for Claude Code (Fable 5.2): SPHEREx moving-object game

## How to use this file (for the team)

1. Open Claude Code at the root of your local clone of `Field2548/NASA-Space-App-Challenge-SPHEREx`, ideally on the Windows laptop that ran the Python scripts, because that is where the downloaded FITS files are cached.
2. Check out the `Film` branch: `git fetch origin && git checkout Film`
3. Put this file at `docs/BUILD_PROMPT.md`, and put the wireframe PDF at `docs/wireframe.pdf`.
4. Tell Claude Code: **"Read docs/BUILD_PROMPT.md and follow it."**
5. Do the "Team must do by hand" list in section 4 as soon as Claude Code asks for it.

Everything below the line is the prompt.

---

# PROMPT

## 1. Mission and deadline

You are the lead engineer for a team of 3 AI engineers at the **NASA Space Apps Challenge 2026**, working on the **"Planet X and SPHEREx"** challenge. None of the team is strong at frontend work, so the web app is your job.

**Build:** a public web game, deployed on **Vercel**, where players find **moving objects** (asteroids, dwarf planets, nearby stars) in **real NASA SPHEREx images** taken at different times. It includes a game-like tutorial at the start, a sky map, image tools, color-blind modes, a video-editor-style timeline, a scoreboard, login/signup that records who found what, and an **Inspect** popup that shows what can honestly be inferred about any clicked pixel or object (section 8.16). It also has a wavelength switch, known-object overlays, a live service status page, and a **live quick look at any coordinate** built from partial file downloads (sections 8.17–8.20).

**Hard deadline: Sunday, November 15, 2026, 22:00 Bangkok time (UTC+7).** Run `date` now and plan against it. Feature freeze is at 19:00. The final production deploy must be done by 21:00. A smaller thing that works beats a bigger thing that breaks.

**Challenge goals** (from the team's challenge brief). The tool should:
- Show SPHEREx sky images of a patch of sky so anyone can see how the patch changes over time, "like a little video."
- Let users type coordinates (RA/Dec) to pick the patch.
- Be tested on **Barnard's Star, Epsilon Indi B, WISE 0855** (RA 08h55m10.831s, Dec −07°14′42.53″), and the variable stars **RW Aurigae** and **R Draconis**.
- Optional ideas from the brief: add or subtract images taken at different times; let the user choose the field of view; overlay other surveys (Gaia, WISE); put coordinates in the URL so others can embed the tool; show metadata such as contamination flags; make it easy to update as new data arrives; use Aladin (CDS) and Astropy tools.

## 2. Read these first, in this order

1. `CLAUDE.md` (Film branch). It covers code layout, physics, gotchas, and conventions. **Follow it.**
2. `README.md`. It has the science, the difficulty ladder, what failed, and the display rules.
3. `motion_frames.py`, `shift_stack.py`, `deglow.py`, `spectral_bands.py`, and `download.py`. Read each module docstring and these functions: `build_frame`, `make_stretch`, `time_colors`, `onion_dark`, `onion_light`, `residuals`, `changes`, `to_png`, `track_positions`, `grid_wcs`, and `shift_stack.search` / `shifted` / `peaks`.
4. `data/motion_*/` (frames.csv, candidates.csv, frame_k.png, summary.png). These are the five ready demo spots.
5. `.claude/skills/*`. Use these skills:
   - `frontend-design` for the look
   - `vercel-react-best-practices` and `vercel-composition-patterns` for React and Next.js code
   - `web-design-guidelines` for the UI and accessibility review
   - `supabase` and `supabase-postgres-best-practices` for auth and the database
   - `webapp-testing` for Playwright checks
   - `deploy-to-vercel` for deploys
   - `asset-license-audit` before every production deploy
6. `docs/wireframe.pdf`, if present (it is described in section 8.1).
7. PR #1 (`refs/pull/1/head`: an M101 sample plus `scripts/download_sample.py`). It is useful background only. Do **not** use its frames in the game (see section 14).
8. Other teams' public SPHEREx projects are listed in section 13. **Borrow ideas only; write all code yourself** (team decision). Every idea you borrow gets a credit line.

## 3. Decisions already made (do not ask again)

| Topic | Decision |
| --- | --- |
| Stack | Next.js (latest stable, App Router) + TypeScript in a new `web/` folder, deployed on Vercel |
| "Type any coordinate" | **Ready spots + live quick look + request queue.** The game plays the pre-processed spots. Any other coordinate gets a **live quick look** (section 8.20): the browser downloads only the small pieces of SPHEREx files it needs. "Request this spot" queues full processing, which the team runs on a laptop with the Python scripts. No live Python on Vercel (see section 7 for why). |
| Quick look rules | Players can **look and mark** there. Marks are checked against JPL known asteroids and saved as candidates, but **earn no points**: there is no answer key, and the data is not masked. |
| Overlays | Known-asteroid and catalog-star overlays are a **full feature**, available in free explore, in quick look, and after Submit. **One short tutorial step** shows them (section 8.13). |
| Other teams' code | **Ideas only, our own code.** Credit each borrowed idea by team name and link (section 13). Never copy code, even from MIT/Apache repos. |
| Spectrum view | A **rainbow spectrum chart**, **compare to known types**, and a **temperature guess** (section 8.16 C). |
| Density map | **Two layers on a HEALPix tree:** (1) **Checked**: sky areas players have finished; (2) **Finds**: where players marked moving objects. Each layer has "Show my work" and "Show others' work" toggles. |
| Sky viewer | **Aladin Lite v3** (CDS, GPL-3.0). The team accepts GPL: **add a GPL-3.0 `LICENSE` at the repo root** and credit Aladin Lite. |
| Auth / DB | Supabase (Auth + Postgres + row-level security), with **guest play** that needs no account. |
| Fonts | **Orbitron** for headings, buttons, and labels. A monospace font (JetBrains Mono, OFL) for numbers, coordinates, and terminal text (see section 12 for why). |
| Inspect: spectrum source | **Pre-made per spot.** Run `spectral_bands.py` for each ready spot (section 6.5). Clicking a pixel shows its real 102-band spectrum. No live IRSA spectrum calls. |
| Inspect: how to open it | **Inspect toggle** (button + `I` key). When it is on, a click opens the popup. When it is off, a click marks a mover. |
| Inspect: spoilers | **Names, types, and distances of known objects stay locked until the player submits.** They are always open in free explore and on the sky map. The server enforces this. |

## 4. Asking the team, and what they must do by hand

Save up your questions and ask them all at once, then keep working on anything that doesn't need an answer. **Ask before:** the first production deploy, pushing to `main`, deleting anything, changing a Python function signature (other scripts import them; see CLAUDE.md), or loading the SPIFF template file (section 6.6; it is a Python pickle, and loading a pickle runs code).

**Team must do by hand** (ask early, and give exact steps):
- Create a free Supabase project. Put its URL, anon/publishable key, and service-role/secret key in `web/.env.local` and in the Vercel project's environment variables. Never commit keys.
- Run `vercel login` / `vercel link` (or connect the GitHub repo in the Vercel dashboard).
- If you are **not** on the laptop with cached FITS files, ask one teammate to run the export commands from section 6 there.
- Ask a teammate to start the `spectral_bands.py` runs from section 6.5 early. They take about 15 minutes per spot and need the network.
- Choose the project name. Until then, use the working title **"ONION//SKY"** and a placeholder `{{PROJECT_NAME}}` constant in one file.

## 5. Architecture

```
            OFFLINE (team laptop, Python)                         ONLINE (Vercel)
 IRSA SIA + cutouts ──► motion_frames.py / shift_stack.py ──► pipeline/export_web.py
                                                                   │
                     web/public/fields/<slug>/  (frames, thumbs, field.json)  ──►  static CDN
                     web/data/answers/<slug>.json  (server-only answer keys)  ──►  /api/check
 spectral_bands.py ──► export_web.py --bands ──► web/public/fields/<slug>/spectrum/ (tiles)
                                             └─► web/data/catalog/<slug>.json (server-only) ──► /api/info
                                                                                       │
  Browser: Next.js app ── Aladin Lite (SPHEREx HiPS from CDS) ── field viewer (canvas)  │
            │                                                                          │
            └── /api/resolve (CDS Sesame) · /api/check · /api/info · /api/density · /api/leaderboard
                /api/request-spot · /api/keepalive (daily cron) ──► Supabase (Auth + Postgres)
                /api/info (outside ready spots) ──► SIMBAD TAP · Gaia TAP · JPL (live, cached)
                /api/overlay ──► pre-made catalog facts (ready spots) or live JPL + Gaia (quick look)
                /api/health ──► pings every outside service (status page)
  Quick look: /api/quicklook/list (IRSA SIA, with cloud_access) ──► browser Web Worker reads
              byte ranges straight from the public S3 bucket nasa-irsa-spherex (fallback: proxy)
```

Repo layout to add:
```
web/                      Next.js app (App Router, TS)
  app/                    routes: / (title), /tutorial, /play, /embed, /credits, /about, api/*
  components/             SkyMap, FieldViewer, ToolsPanel, VisionPicker, BrightnessSlider,
                          Timeline, FramePicker, Scoreboard, AuthDialog, CoachMark,
                          InspectPopup, SpectrumChart, LightCurveBars, WavelengthSwitch,
                          OverlayToggles, QuickLook, StatusBadge
  app/status/             the service status page (section 8.19)
  lib/                    coords, wcs, sipwcs, fits, quicklook, overlays, spectra, fields,
                          framePicker, imaging, palettes, marks, healpix, inspect,
                          scoring (server), supabase (client/server)
  workers/quicklook.ts    Web Worker: partial downloads + resampling for quick look
  public/ref/             reference spectra (converted SPIFF templates) + Teff table, with licenses
  public/fields/<slug>/   exported data (see section 6), including spectrum/ tiles
  data/answers/           answer keys (NOT under public/)
  data/catalog/           pre-made catalog facts per spot (NOT under public/; section 6.5)
pipeline/export_web.py    new: export ready spots for the web
pipeline/build_pool.py    new (Tier 2): many bursts per spot so players can choose frames
supabase/migrations/      SQL from section 10
CREDITS.md  LICENSE (GPL-3.0)
```

Work on a new branch `web` made from `origin/Film`. Commit small and often. Open a PR into `Film` once Tier 1 works.

## 6. Data export (Python): make the ready spots

### 6.1 Ready spots (Tier 1: already processed in the repo)

| Slug | Folder | Size | Level | Answer source |
| --- | --- | --- | --- | --- |
| `eros` | `data/motion_13.2004_14.38_2025-07-09` | 0.2° → 119×119 px | Easy | JPL Horizons track of 433 |
| `hektor` | `data/motion_184.3049_-6.3773_2025-12-24` | 0.2° → 119×119 | Medium | Horizons 624 + bot candidates |
| `makemake` | `data/motion_200.0075_21.523_2025-05-30` | 0.1° → 59×59 | Hard | Horizons 136472 + bot |
| `eris` | `data/motion_26.3271_-0.4338_2026-01-06` | 0.1° → 59×59 | Boss ("beat the bot") | Horizons 136199 + bot |
| `cygnus` | `data/motion_304.6935_42.4437` | 0.2° → 119×119 | Control: nothing moves | none (bot found nothing above its noise bar) |

### 6.2 `pipeline/export_web.py FOLDER --slug S --title T --difficulty D [--track ID | --star NAME]`

Choose the source in this order:
1. **`FOLDER/frames.fits` exists.** Use it: float S/N planes, WCS, `MJDk` and `PSFFWHM` keywords. This is best.
2. **It doesn't exist** (FITS files are gitignored). Try re-running `motion_frames.py` with the exact command in its docstring. The `sia_results.ecsv` search cache is committed, so only the cutout downloads hit IRSA. Expect 502/503 errors; the scripts retry.
3. **Still nothing (no network).** Use **PNG fallback**: load the committed `frame_k.png` files, convert them to gray, and downsample by the integer upscale factor (4 for 119 px, 8 for 59 px; nearest neighbour). That recovers the native grid as 8-bit values that already use the shared asinh stretch. Rebuild the WCS with `spectral_bands.grid_wcs(SkyCoord(ra, dec), fov)`. Mark the field `"precision": "png8"` so the UI says "preview quality."

Write:
- `web/public/fields/<slug>/field.json`. The schema is below.
- `frames.u16`: all frames in one file, as little-endian Uint16, N×H×W, **rows top-down** (flip FITS rows once here; FITS row 0 is the bottom). Quantize as `value = round((S/N − offset) / scale)` and store `scale` and `offset`. One 119×119 frame is about 28 KB before brotli.
- `thumbs/k.webp`: 48×48 previews for the timeline (the low level of detail).
- `web/data/answers/<slug>.json`, **not public**:
  - known object positions per frame, as `x, y` in the top-down pixel grid, from `motion_frames.track_positions`
  - bot candidates from `candidates.csv`, with y converted to top-down
  - the noise bar for each field from the README table (Eris 5.9σ, Makemake 6.4σ, Hektor 6.4σ, Cygnus 8.4σ), or from re-running `shift_stack.py`
  - `nothing_moves: true` for Cygnus
- `web/public/fields/index.json`: a list of ready spots (slug, title, ra, dec, fov, difficulty, kind, thumbnail).
- **`exposures.u16` + `exposures.json` (team request: the wavelength switch in 8.17 and the mover spectrum in 8.16 C):**
  - every single exposure behind the frames, resampled onto the same grid: K×H×W, Uint16, rows top-down
  - per-exposure `scale` and `offset`, in MJy/sr after zodi and background subtraction, plus its noise
  - per exposure: frame index, MJD (`DATE-OBS`), detector, `obs_id`, its IRSA/S3 file path (for provenance)
  - a coarse wavelength map (8×8 grid) from the spectral WCS (`WCS(header, key="W")`, as in `download.wavelength_at`), resampled onto our grid
  - About 1 MB per 0.2° spot. Reuse `clean_band` and `resample` without changing their signatures. This needs FITS, so it is not available in PNG-fallback mode; hide those features there.

```json
{
  "slug": "eros", "title": "(433) Eros", "kind": "asteroid", "difficulty": "easy",
  "ra": 13.2004, "dec": 14.38, "fov_deg": 0.2, "pixel_arcsec": 6.15, "size": [119, 119],
  "wcs": { "ctype": ["RA---TAN", "DEC--TAN"], "crval": [13.2004, 14.38], "crpix": [60, 60],
           "cdelt": [-0.0017083, 0.0017083], "rows": "top-down" },
  "frames": [ { "i": 1, "mjd": 0, "utc": "2025-07-09T18:04:04", "hours_since_prev": 0,
                "n_bands": 8, "detectors": [3, 6] } ],
  "data": { "format": "u16", "file": "frames.u16", "scale": 0.01, "offset": -10, "units": "S/N",
            "precision": "float" },
  "thumbs": ["thumbs/1.webp"],
  "stretch": { "black_sigma": -1, "soft_sigma": 2, "white": 0 },
  "psf_fwhm_px": 1.6
}
```
Fill `mjd`, `scale`, `offset`, `white`, and `psf_fwhm_px` from the real data. `crpix` is the center pixel from `grid_wcs`. Take the detectors from the file names in `frames.csv`.

### 6.3 Tier 2: challenge test targets (run on the laptop, in parallel with the web work)

Write `pipeline/run_star_targets.ps1` (and `.sh`) for a teammate to run. Stars move slowly, so frames must be **months apart, one burst per survey pass** (SPHEREx maps the whole sky every ~6 months, starting May 2025). Example: `--frames 3 --min-spacing 3600` (hours).
- **Center on today's position, not the J2000 position.** Get proper motion from SIMBAD/Gaia (`astroquery.simbad`) and move the position with `SkyCoord.apply_space_motion` to each frame's time. Barnard's Star moves about 10″ per year, so its J2000 position is several arcminutes off by 2026. Draw the expected position per frame in the answer key (the same idea as `--track`, but for a star).
- Expected motion is only ~1–2 SPHEREx pixels per year (6.15″ per pixel). Label these spots "Expert: tiny motion," and be honest in the UI if a star is not clearly seen to move.
- **Barnard's Star** is very bright, so check FLAGS for saturation and bloom. **WISE 0855** is a very cold brown dwarf that is faint at short wavelengths. Also make long-wavelength-only frames (detectors 5–6) for it, and say in the UI if it is not visible.
- **RW Aurigae and R Draconis** change **brightness**, not position. Export them as "Did it change?" spots. The answer is "brightness changed," checked with `residuals`.
- Known limitation: different bursts see different wavelengths, so a star's brightness can differ between frames. `residuals` already scales by bright stars. Where possible, prefer bursts from the same detector pair.

### 6.4 Tier 2: `pipeline/build_pool.py`

This builds 10–16 bursts per spot so players can choose how many frames and how far apart (section 8.9). Reuse `group_bursts`, `download_image`, and `build_frame` without changing their signatures. Write `pool.u16` and pool metadata in the same format as above. **Until pools exist, the frame picker works over the 5 exported frames.**

### 6.5 Tier 2 (team request): spectrum cubes and catalog facts for Inspect

**Spectrum cubes.** A teammate runs these on the laptop, in parallel with the web work. Each takes about 15 minutes per spot the first time.

Use `--out` so the committed 0.1° Cygnus figures that the README links to are not overwritten. 0.2° spots need `--size ≥ fov × 1.41`.

```
python spectral_bands.py 13.2004 14.38    --size 0.3 --fov 0.2 --out data/bands_eros
python spectral_bands.py 184.3049 -6.3773 --size 0.3 --fov 0.2 --out data/bands_hektor
python spectral_bands.py 304.6935 42.4437 --size 0.3 --fov 0.2 --out data/bands_cygnus
python spectral_bands.py 200.0075 21.523                       --out data/bands_makemake   # defaults: --size 0.15 --fov 0.1
python spectral_bands.py 26.3271 -0.4338                       --out data/bands_eris
```

Same center and same fov means `grid_wcs` gives **the same pixel grid as the motion frames**, so pixel (x, y) matches. Fallback if only the old 0.1° Cygnus cube exists: it covers the central 59×59 pixels of the 119×119 grid (offset 30). Outside that area, the popup says "No spectrum here."

Then `export_web.py FOLDER --slug S ... --bands data/bands_<slug>` also writes:
- **`web/public/fields/<slug>/spectrum/index.json`**:
  - the 102 bands from `bands.csv`: band, detector, wavelength_um, bandwidth_um, date_obs
  - per-band `scale` and `offset`
  - per-band noise (sigma-clipped std over the spot, in MJy/sr)
  - tile size
- **`spectrum/t_<tx>_<ty>.u16`**: 32×32-pixel tiles × 102 bands, Uint16, rows top-down, `65535` = no data. About 209 KB per tile before brotli. A tile loads only when Inspect first touches it, which is level of detail for the cube. If short on time, one `cube.u16` per spot is fine.
- **`web/data/catalog/<slug>.json`** (server-only), built with `astroquery`:
  - one SIMBAD cone and one Gaia DR3 cone that cover the whole spot (columns in section 7), with each star's position moved to every frame's date using its proper motion (Gaia's reference epoch is 2016.0; SIMBAD positions are for 2000.0)
  - JPL Horizons distances r and Δ for the answer-key objects at each frame time
  - **known asteroids and comets in the spot at each frame time**, from the JPL SB Identification API (the overlay in 8.18)

  With this file, the popup and overlays need no live network calls for ready spots during judging.

### 6.6 Reference spectra for "compare to known types" (team request)

- **Brown dwarfs (L, T, Y types):** the SPIFF library (`jgagneastro/SPIFF`, **MIT license**) ships SPHEREx templates per spectral type as `src/spiff/data/spherex_templates.joblib`, with `spherex_bins.csv`.
  - A `.joblib` file is a Python pickle, and loading a pickle runs code. **Ask the team first.** Then pin one commit, read the loader, and load the file once in a throwaway virtual environment with no secrets in it.
  - Convert the templates to `web/public/ref/spherex_templates.json` and commit that JSON with SPIFF's MIT license text next to it (`web/public/ref/LICENSE-SPIFF.txt`).
  - Cite the paper (Gagné et al. 2026, arXiv:2604.22012) in `CREDITS.md`.
- **Spectral type → temperature:** use Eric Mamajek's "A Modern Mean Dwarf Stellar Color and Effective Temperature Sequence" table (it includes L, T, and Y types). Save the needed columns as `web/public/ref/spt_teff.json`. Cite Pecaut & Mamajek (2013, ApJS 208, 9), as the table's header asks.
- **Normal stars and asteroids:** use simple blackbody curves (Planck's law) that you compute yourself. No outside data is needed.
- If the SPIFF conversion is not approved or fails, ship blackbody-only comparison and say so in the UI.

## 7. Real APIs and services (checked November 15, 2026)

Call third-party APIs **from Next.js route handlers**, not from the browser. This avoids CORS problems, keeps keys secret, and lets you cache. Use retries with backoff, because IRSA often answers 502/503. **One exception:** quick look's byte-range reads from the public S3 bucket go straight from the browser, because no key is involved and the files are large (section 8.20).

| Need | Service | Endpoint / ID | Notes |
| --- | --- | --- | --- |
| Find SPHEREx images at a position (pipeline) | IRSA SIA v2 | `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&POS=circle+RA+DEC+RADIUS` | Already used via `astroquery` (`Irsa.query_sia`). Collections in the repo: `spherex_dr1`, `spherex_qr3` (+ `_deep`). |
| Small pieces of images (pipeline) | IRSA image cutouts | `<access_url>?center=RA,DEC&size=DEG` | As in `download.cutout_url`. |
| Metadata queries (optional) | IRSA TAP | `https://irsa.ipac.caltech.edu/TAP` (tables `spherex.artifact`, `spherex.plane`) | Used in IRSA's SPHEREx tutorials. |
| All-sky background image | CDS HiPS of SPHEREx QR2 | `CDS/P/SPHEREx/QR2/color` (also `.../D1` … `.../D6`) | Published by CDS under **ODbL**; credit it. Use this, **not** Aladin's default DSS background, which carries third-party plate copyrights. |
| Sky viewer with level of detail | Aladin Lite v3 | npm `aladin-lite` (pin the version), or `https://aladin.cds.unistra.fr/AladinLite/api/v3/<version>/aladin.js` | GPL-3.0. Client-only: dynamic import with `ssr: false`. |
| Name → coordinates | CDS Sesame | `https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?<url-encoded name>` | Parse `<jradeg>` and `<jdedeg>` from the XML. Cache for 1 day. |
| Known asteroid positions | JPL Horizons API | `https://ssd.jpl.nasa.gov/api/horizons.api` | The pipeline uses `astroquery.jplhorizons` (location `500` = geocenter). |
| "Is a known asteroid here at this time?" | JPL Small-Body Identification API | `https://ssd-api.jpl.nasa.gov/sb_ident.api` | Use it to check player marks that match no answer key: observer `mpc-code=500`, field center plus half-width, `obs-time` = frame time. Read the API docs for the exact parameter names. |
| Star proper motions (pipeline) | SIMBAD / Gaia DR3 via `astroquery` | — | For the section 6.3 targets. |
| Object names, types, redshifts (Inspect) | SIMBAD TAP | `https://simbad.cds.unistra.fr/simbad/sim-tap/sync` | ADQL on table `basic`: `main_id, otype, sp_type, plx_value, rvz_redshift, pmra, pmdec`. Cone: `CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', RA, DEC, R)) = 1`. SIMBAD asks for **≤ 6 queries per second**, so cache and debounce. |
| Star distances and motions (Inspect) | ESA Gaia archive TAP | `https://gea.esac.esa.int/tap-server/tap/sync` | Table `gaiadr3.gaia_source`: `source_id, ra, dec, parallax, parallax_over_error, pmra, pmdec, phot_g_mean_mag`. Follow Gaia's credit and citation guide. |
| Asteroid distances (Inspect) | JPL Horizons API | same endpoint as above, with `QUANTITIES='19,20'` and `CENTER='500@399'` | 19 = distance from the Sun (r), 20 = distance from the observer (Δ). |
| SPHEREx files for quick look (partial downloads) | IRSA's public AWS S3 bucket | Bucket `nasa-irsa-spherex` (region `us-east-1`), `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/<key>` | No AWS account needed. IRSA's SIA results include a `cloud_access` column with the bucket and key for each file. Read with HTTP `Range: bytes=a-b` requests. **Check CORS on day one**; if the browser is blocked, proxy the range reads through a Vercel route. Credit IRSA and the AWS Open Data program. |
| Reference spectra | SPIFF templates (MIT) + Mamajek Teff table | section 6.6 | Converted once offline, then served as static JSON. |
| Professional-quality spectrum (link only) | IRSA SPHEREx Spectrophotometry Tool | `https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry` | A queue-based web tool that needs manual input. **Link to it; don't call it live.** |
| Login + database | Supabase | Free plan | 500 MB DB, 50,000 monthly active users. **Free projects pause after 1 week with no activity.** Judging starts Nov 16 and results come out in Dec–Jan, so see the keep-alive in section 8.12. |
| Hosting | Vercel (Hobby) | — | Functions run for at most **300 s**. Python functions can be up to 500 MB. Cron runs **at most once per day**. The Python pipeline takes minutes per spot and IRSA is flaky, so **live Python processing is not used**. Quick look does its light work in the browser instead (8.20). |
| HEALPix math | `@hscmap/healpix` (MIT) | — | NESTED scheme, order ≤ 15. Do **not** use `healpixjs` (AGPL-3.0). |
| Icons | `lucide-react` (ISC) | — | Includes a dice icon for the random button. |
| Fonts | Orbitron and JetBrains Mono (both OFL-1.1) via `next/font/google` | — | `next/font` self-hosts the files at build time. |

**Not used:** OpenCV.js. Its license (Apache-2.0) is fine, but the browser build is ~11 MB for six simple operations on 119×119 images. Write them in TypeScript instead (section 9).

## 8. Screens and features

### 8.1 Layout (follows the wireframe; desktop 1440×900)

The wireframe is reference only. Do not reuse any picture from it (see section 13).

- **Top bar:** logo + project name (left; own SVG, no emoji image); **Log in / Sign up** (right).
- **Left panel (≈220 px), top to bottom:** the **INSPECT** toggle (magnifier icon, `I` key), **IMAGE TOOLS** (renamed from "OpenCV tools"), **WAVELENGTH** switch (8.17), **OVERLAYS** toggles (8.18), **COLOR VISION**, **BRIGHTNESS** slider.
- **Footer:** a small status light (green, amber, or red) that links to `/status` (8.19), plus Credits.
- **Center:** the big viewport.
  - Sky map mode: Aladin Lite, full sky in an Aitoff/Mollweide projection with the **galactic** frame, so the Milky Way is horizontal like in the wireframe.
  - Field mode: the time-series viewer.
  - **Coordinate box** at the top-left of the viewport, with a dice button.
  - **"Show my work" / "Show others' work"** toggles at the top-right.
  - **Zoom + / −** at the bottom-right.
  - A status line at the bottom-left showing the pointer position (RA/Dec, J2000).
- **Right panel (≈240 px):** **SCOREBOARD**, which collapses to a thin tab ("click to minimize").
- **Bottom (≈170 px, full width):** the **timeline**. The **Frames & spacing** controls sit at its left, where the wireframe says "linear or exp scale."
- **Tier 3:** a mobile layout where the panels become bottom sheets.

### 8.2 Sky map, level of detail, and density layers

- Aladin Lite with `CDS/P/SPHEREx/QR2/color`. HiPS is already a quadtree of tiles with **level of detail**: zooming in loads finer tiles.
- Ready spots appear as reticle markers colored by difficulty. Clicking one shows a preview card (thumbnail, level, "Play"). "Play" goes to field mode.
- **Density layers:** draw HEALPix cells as Aladin graphic-overlay polygons. Get cell corners from `@hscmap/healpix`. The HEALPix order follows the zoom (orders 3–5 for the full sky, up to ~10 zoomed in). Counts come from `/api/density` (section 10), and color comes from a heat scale.
- **Checked** layer: a spot counts as checked when a player submits "found it" or "nothing moved" there.
- **Finds** layer: one count per marked mover.

### 8.3 Coordinate box (wireframe item 7)

- Accepts decimal degrees (`133.795 -7.245`), sexagesimal (`08h55m10.831s -07d14m42.53s`, `08:55:10.8 -07:14:42`), and **object names** (`Barnard's Star`, `M101`), which go through `/api/resolve`.
- Show what was understood (`RA 08h55m10.83s  Dec −07°14′42.5″`) or a clear error.
- Enter → fly the sky map there. If a ready spot is within its field of view, offer "Play." Otherwise offer **"Quick look (live)"** (section 8.20) and **"Request full processing"** (section 8.14).
- **Dice:** jump to a random ready spot.
- **URL state:** `/play?ra=&dec=&fov=&spot=&frames=&spacing=&vision=` restores the view. `/embed?...` is a minimal viewer for iframes (the brief suggests this).

### 8.4 Field viewer

- Canvas with `imageSmoothingEnabled = false` and integer upscale (**nearest-neighbour**, a repo rule).
- **One shared stretch for all frames** (`make_stretch` logic: asinh, black point at −1σ, soft at 2σ). Never stretch each frame on its own.
- Overlays (Color by time, Paper mode) use a second shared stretch with the **black point at +1σ**, like `motion_frames.main` (`st_on`). Otherwise every frame's sky noise adds up into colored confetti.
- Click a pixel to mark it. If Inspect is on, the click opens the info popup instead (section 8.16). The cursor and the status line always show which mode is on. Hover shows the pixel, RA/Dec, and S/N.
- Frame info strip: UTC time, "+21.1 h" gap, number of bands, detectors.
- A "preview quality" badge when the data is `png8`.

### 8.5 Image tools (wireframe item 2): plain names, easy ones only

| Button | What a normal person reads | What it does | Mirrors |
| --- | --- | --- | --- |
| **Color by time** | "Still things turn white. Moving things leave colored dots." | Additive time-tinted stack; colors scaled to sum to white | `onion_dark` |
| **Paper mode** | "Same, but on white paper." | Multiply blend | `onion_light` |
| **Show only changes** | "Hide everything that stayed the same." | Leave-one-out median subtraction with bright-star brightness match, shown from 3σ | `residuals`, `changes` |
| **Remove star glow** | "Turn fuzzy stars into small points." | Grey white top-hat (disk ≈2.5 px) | `deglow.tophat` |
| **Make dots bigger** | "Make tiny dots easier to see." | Grey dilation, radius 1 px | (new; the team asked for dilation) |
| **Follow & stack** (Tier 2) | "Drag the arrow to follow a guess. The right guess makes a faint mover pop out." | Integer shift-and-add along (vx, vy) px/day, live while dragging | `shift_stack.shifted` |

Show at most two at once (Color by time + one cleanup). Each button gets a one-line tooltip and an "i" that opens a 3-sentence explainer.

### 8.6 Color vision (wireframe item 3)

- **One choice, not checkboxes:** Normal · Red-weak (protan) · Green-weak (deutan) · Blue-weak (tritan) · No color.
- `timeColors(n, vision)`:
  - Normal, protan, and deutan use the repo's **Okabe–Ito** order (`#0072B2 #56B4E9 #009E73 #E69F00 #D55E00 #CC79A7 #F0E442`).
  - Tritan gets its own palette.
  - Keep the **scale-to-white** step so still stars stay white.
- **Test:** simulate each palette under each type (Machado 2009 matrices) and assert that all pairs of n ≤ 7 colors stay clearly different (CIEDE2000 ≥ 10). Adjust until the test passes.
- **No color mode:** turn off Color by time. Use blink, Show only changes, frame numbers on markers, and the timeline instead.
- Never use color as the only cue. Markers also show the frame number.

### 8.7 Brightness slider (wireframe item 4)

- One horizontal slider, **"Fainter ⟷ Brighter,"** on a log scale. It moves the black point in S/N units (default −1σ, like the repo).
- Landmarks along the scale are **real objects the team measured** (README):
  - "Eros: very bright"
  - "Hektor: S/N ~150"
  - "Makemake: S/N ~2–12"
  - "Eris: S/N ~2–4, needs Follow & stack"
- Include a Reset button. In `png8` mode the slider remaps levels instead.

### 8.8 Timeline (wireframe item 8): video-editor style

- **Track 1, Frames:** clip blocks with thumbnails. Each clip border uses that frame's time color (like `summary.png`). Labels show the date and time and the "+gap."
- Playhead with scrubbing. Play/pause, loop or ping-pong, step with ← and →.
- **Speed is capped at 3 frames/second** (flashing safety, WCAG 2.3.1). With `prefers-reduced-motion`, there is no auto-play.
- **Onion range handles** pick which frames go into Color by time, like onion-skin range in animation software.
- **Track 2, My marks:** dots where I clicked in each frame.
- **Track 3, Answers:** after checking, shows the known object, the bot, and others' marks.
- Clips are evenly spaced. A "real time spacing" toggle draws true gaps, on a log scale when spacing is Growing.

### 8.9 Frames & spacing (wireframe item 9)

- **Frames:** 2–7 for Color by time (7 Okabe–Ito colors that add up to white). Blink can use all frames in the pool.
- **Spacing:** **Even** (linear: t₀ + k·Δ) or **Growing** (exponential: t₀ + Δ·(2ᵏ − 1)). **Minimum gap** is a log slider from hours to days.
- `pickFrames` **snaps each target time to the nearest real burst** after the previous one (a greedy approach like `pick_window`). Tell the player in one line: "SPHEREx only looks at a spot at certain times, so we use the closest real moments."
- Why Growing helps: one view can show fast movers (short gaps) and slow movers (long gaps).

### 8.10 Marking, checking, and scoring

1. The player clicks the suspected mover in **≥2 frames**, or clicks two colored dots in Color by time.
2. `fitTrack` fits position + velocity (px/day). If the motion is under 1 px total, say "That one didn't move; it's a star."
3. **Submit** → `POST /api/check`. The server, using the private answer key:
   - matches a known object within 2 px in ≥2 frames → "Confirmed: (433) Eros, near-Earth asteroid"
   - matches a bot candidate above the noise bar (position within 2 px, velocity within ~2 px/day) → "Matches the bot"
   - otherwise, `sb_ident` checks for a known asteroid
   - otherwise → "Unconfirmed candidate." It is saved and counts in the Finds layer, but earns no points until ≥3 players agree.
4. **"Nothing moved here"** is a valid answer, and it is correct for Cygnus. Marks on still stars cost accuracy.
5. **Points:** Easy 100 · Medium 250 · Hard 500 · Boss 1000 · Expert (stars) 750. First finder of an object gets +50%. Accuracy % = correct submissions ÷ all submissions. **Points are only ever computed on the server.**
6. **Distance hint (Tier 2):** "Moves 15″/hour, similar to Hektor (a Jupiter trojan, ~5 AU)." Compare against the team's measured rates: Hektor ≈15.3″/h, Makemake ≈1.6″/h, Eris ≈0.36″/h (from `candidates.csv`; add Eros from its JPL track).
   - **Do not use the CLAUDE.md opposition formula for this.** SPHEREx looks roughly sideways from the Sun, not at opposition, and the formula is far off on this data. For example, it predicts ~1.4″/h for Eris, but the team measured ~0.36″/h.
   - Present the hint as a rough comparison, not a distance measurement.

### 8.11 Scoreboard (wireframe item 5)

- Right panel that collapses to a thin vertical tab. Tabs: **This spot / All time**.
- Columns: rank, name, score, accuracy %.
- A plain **"Show me at top"** toggle pins my row (replaces the gear icon).
- A **BOT** row ("Shift-and-stack bot") scored from the bot's candidates that match known objects, clearly labeled as a bot. This is the "Beat the Bot" angle.
- An empty state in ASCII. Refresh after submit and every 30 s.
- Never show emails. If Supabase is unreachable, fall back to `public/leaderboard-snapshot.json`.

### 8.12 Login / signup + guest (wireframe item 10)

- Supabase Auth with email + password. GitHub OAuth is Tier 3.
- **"Play as guest"** keeps progress in localStorage. Signing up later moves that progress into the account. Judges must be able to play without an account.
- Profile: display name, 3–20 characters, unique, shown on the scoreboard.
- Each find stores `user_id`, so the app knows **who found each object first**.
- **Keep-alive:** a daily Vercel Cron job → `/api/keepalive` runs a tiny query, so the free Supabase project doesn't pause while judges review. The app must also still work (guest mode, static spots, scoreboard snapshot) if the database is down.

### 8.13 Tutorial: a real game, step by step (task 2)

The title screen `/` has a "PRESS START" feel with an ASCII starfield and three buttons: **Start training**, **Skip to game**, **Log in**.

`/tutorial` uses real data. UI parts unlock one by one, coach marks point at the next thing to do, and each step auto-detects when it is done. Progress is saved, steps can be skipped, and everything works from the keyboard.

| Level | Spot | Goal | Unlocks |
| --- | --- | --- | --- |
| 0 Boot | Eros | "These are real SPHEREx pictures of one patch of sky at different times." Press Play. | timeline |
| 1 First contact | Eros | Find the dot that jumps. Mark it in 2 frames. Reveal "(433) Eros": Inspect opens on it and shows its real distance from Earth. **Then one short overlay step:** "Turn on Known asteroids." JPL's predicted spots (diamonds) land on the dots you found. | Color by time, Inspect, Overlays |
| 2 Crowded sky | Hektor | Find the mover among many stars. | Show only changes, Remove star glow |
| 3 Faint target | Makemake | Use brightness and wider spacing. | brightness, Frames & spacing |
| 4 Empty sky | Cygnus | Learn that "Nothing moved here" can be right. After answering, turn on Catalog stars (every still dot gets a ring), then Inspect a bright star and read its rainbow spectrum, "looks most like…", and Gaia distance (now unlocked). | the "Nothing moved" button |
| 5 Boss: beat the bot | Eris | Try Follow & stack, or see that the bot found Eris at 6.9σ against a 5.9σ noise bar. Report that small margin honestly. | scoreboard, free play |

Write all copy in **simple words**. One idea per step. No jargon without a one-line explanation.

### 8.14 Request-a-spot queue

`POST /api/request-spot {ra, dec, fov}` saves a row with status `queued`. Add a page `/requests` that lists the queue. Write `pipeline/process_requests.py`, which reads the queue (with the service key from a local `.env`), runs `motion_frames.py` + `shift_stack.py` + `export_web.py`, and prints the git commands to publish. The team runs it by hand.

### 8.15 Credits and About pages

- `/credits` renders `CREDITS.md` and is linked in the footer.
- `/about` covers how it works (onion skin, changes, shift-and-stack, honest noise bars), the data sources, and **how AI was used** (section 13).

### 8.16 Inspect: the info popup (team request)

**Goal:** click any pixel or object and see everything that can **honestly** be inferred about that spot, plus a plain statement of what can't be. Every number shows its source (SPHEREx, Gaia, SIMBAD, or JPL) and is marked "approx." where needed. **Never invent a value.**

**Opening it:**
- Turn on the **Inspect** toggle, then click.
- On the sky map, Inspect works the same way. It shows catalog facts only, unless the point is inside a ready spot; then it also offers "Open spot."

**Popup:**
- A panel next to the clicked pixel, never covering it. Draggable, closes with Esc, reachable by keyboard; a bottom sheet on mobile.
- Title: `INSPECT // px 63,41`.

Sections, top to bottom:

| Section | Shows | Source | During a round |
| --- | --- | --- | --- |
| **A. Where** | RA/Dec (sexagesimal + degrees), galactic l/b, ecliptic latitude. Add the hint "Near the ecliptic: asteroids are common here" when \|β\| < 10°. | WCS math | shown |
| **B. Over time** | Small bar chart of the signal (S/N, max of the 3×3 pixels, like the repo's `--track` check) at this pixel in each selected frame. Bars use that frame's time color and its number. Verdict: "steady," "changed in frame k" (leave-one-out residual ≥ 5σ), or "too faint." Each frame's date and detectors. | frames | shown |
| **C. Spectrum** | The **rainbow spectrum chart**, "looks most like…", and a temperature guess, as described in "C. Spectrum view" below. For a mover, also the spectrum **along its path**. "Download CSV" button. | cube, per-exposure planes, references | shown |
| **D. What is it?** | SIMBAD objects within 9″ (name, type in plain words such as "Star," "Galaxy," "Brown dwarf," "Variable star," spectral type, link). Nearest Gaia DR3 source within 6″ (G magnitude, parallax ± error, proper motion). Known asteroids and comets within ~2 px of this pixel at any frame time. | SIMBAD, Gaia, JPL | **locked** |
| **E. How far?** | Distance, by the rules below. | JPL / Gaia / SIMBAD | **locked** |
| **F. Can't tell from here** | One line, for example: "Age and exact chemical amounts can't be measured from this data." | — | shown |
| **G. Links** | SIMBAD page; IRSA Spectrophotometry Tool (for a professional-quality spectrum). | — | **locked** |

**Spectrum hints.** Show a hint only when the data supports it:
- **Color:** compare this pixel's averages at 1–1.5 µm, 2–2.5 µm, and 4.4–5 µm with the median of bright stars in the same spot. Say "bluer than most stars here," "like most stars here," or "much redder (cool, dusty, or behind a cloud)." Because it is relative to the spot, no calibration guesswork is needed.
- **Ice dips / PAH glow:**
  - Fit a straight continuum on both sides of each feature: 3.0 µm uses 2.6–2.8 and 3.5–3.7 µm; 4.27 µm uses 4.1–4.2 and 4.35–4.45 µm; 4.67 µm uses 4.5–4.6 and 4.75–4.85 µm.
  - Report "possible water-ice dip" (or CO₂, or CO) only if the dip is ≥ 3σ deep. Report "possible PAH glow" only for a ≥ 3σ bump at 3.3 µm. Otherwise say nothing.
  - Never say "exact amount."
- **Caveat line (always visible):** "Built from single images taken over many months. Things that move are not in it. One pixel (6.15″) can mix several objects. A lone spike can be a cosmic-ray hit or a passing asteroid."
- If the spot has no cube yet, or the pixel is outside it: "No spectrum for this spot yet."

**C. Spectrum view (team request; the style follows the team's reference screenshot, but draw everything yourself)**

1. **Rainbow spectrum chart**
   - x-axis: wavelength 0.75–5.0 µm. y-axis: brightness (MJy/sr per pixel for the cube; mJy for an aperture sum).
   - One dot per band, colored by wavelength along a violet → blue → cyan → green → yellow → orange → red ramp, with a thin line through the dots. Draw error bars.
   - Label the axis note: "False color: infrared is invisible, so colors stand in for wavelength."
   - The color is decoration. Wavelength is already on the x-axis, so color-blind users lose nothing. In "No color" vision mode, draw the dots in gray.
   - **Shaded, labeled molecule bands**, in two families so players don't mix them up:
     - **Gas in cool star and brown-dwarf atmospheres:** H₂O near 1.4, 1.9, and 2.7 µm; CH₄ near 2.2–2.4 and 3.2–3.6 µm; CO₂ near 4.2–4.35 µm; CO near 4.5–4.8 µm
     - **Ice and dust in clouds:** H₂O ice 3.0 µm, PAH glow 3.3 µm, CO₂ ice 4.27 µm, CO ice 4.67 µm
     - Keep the band ranges in one config file with a source comment, so the team can check them.
   - Hovering a dot shows its band number, wavelength, value ± error, detector, and date.
2. **Spectrum along a mover's path** (for a known mover, a bot candidate, or the player's own track)
   - Use the per-exposure planes (section 6.2). For each exposure, put an aperture (radius ≈1.5 px, background from a ring) at the track's position **at that exposure's time**.
   - Convert to mJy: sum of MJy/sr × (6.15″ pixel as a solid angle, about 8.9×10⁻¹⁰ sr) × 10⁹. Plot it at the wavelength that exposure saw at that spot (the coarse wavelength map).
   - Label it "N of 102 bands, measured along its path." Caveat: "Brightness can also change between visits as the object spins or its distance changes."
   - Idea credit: "Spectrum along its path" in Andrei25Ciuta/SPHEREx, and Cipher-X Crew's comet spectral trace (section 13).
3. **"Looks most like…" (compare to known types)**
   - Normalize the pixel's (or mover's) spectrum and each reference to their median over the shared bands. Resample each reference to the measured wavelengths and compute χ² with the measured errors.
   - Show the best match and the runner-up, each drawn over the data as a thin dashed line, with a match-quality word: "good," "rough," or "poor."
   - References:
     - brown-dwarf types L, T, and Y (SPIFF templates, section 6.6)
     - blackbody curves for stars
     - for movers only, "reflected sunlight" (a ~5800 K blackbody) and "sunlight + heat glow at 4–5 µm"
   - If even the best match is poor: "Doesn't look like any of our reference types."
   - Only show a match when the target has S/N ≥ 5 in at least 20 bands. Otherwise say "too faint to compare."
4. **Temperature guess**
   - For a brown-dwarf match, look up the matched type's temperature in the Mamajek table (for example, "about 1300 K, from type T1"). For a star, show the blackbody fit's temperature.
   - Always say **"approx."** and add one line on why: dust between us and the star makes it look cooler.
   - Near-infrared barely changes for hot stars. Above about 5000 K, show "hotter than about 5000 K" instead of a number.
   - For movers, show **no temperature**. Asteroids mostly reflect sunlight, so a "temperature" would mislead.
   - Never show an age.

**Distance rules (section E):**
1. **A known solar-system object near this pixel:** distance from Earth (Δ) and from the Sun (r) at that frame's time, in AU, km, and light-minutes. Source: JPL Horizons.
2. **A Gaia star with `parallax_over_error ≥ 5`:** distance ≈ 1000 / parallax (mas) parsecs, also shown in light-years (× 3.2616). If the ratio is below 5, say "Too far or too faint for a reliable distance."
3. **A galaxy or quasar with a SIMBAD redshift:** approximate light-travel distance using Planck 2018 cosmology (H₀ ≈ 67.7 km/s/Mpc, Ωm ≈ 0.31). Label it "approx., from catalog redshift."
4. **The player's own tracked mover with no catalog match:** its rate in ″/hour plus the "similar to Hektor" comparison from 8.10. Label it "not a distance."
5. **Otherwise:** "SPHEREx alone can't measure this object's distance."

Never compute a star's distance from SPHEREx positions. Even Barnard's Star's yearly parallax wobble (~0.55″) is under a tenth of a 6.15″ pixel.

**Spoiler lock (team decision):**
- During a round (a tutorial level, or play before Submit), sections D, E, and G show `[LOCKED] Names and distances unlock after you submit.`
- After Submit, and always in free explore and on the sky map, everything unlocks.
- **Enforce this on the server.** `/api/info?mode=round` returns no names, types, distances, or JPL results.
- After a correct find, auto-open Inspect on the object as the reward, for example: "(433) Eros was 0.xx AU from Earth in frame 1." Use the real value.

**Where the data comes from:**
- **Ready spots:** everything is pre-made by `export_web.py` (section 6.5), so the demo needs no live calls.
- **Elsewhere (sky map):** `/api/info` calls SIMBAD TAP, Gaia TAP, and JPL live, in parallel, with an 8 s timeout each. Partial results are OK. Cache by position rounded to 1″.

### 8.17 Wavelength switch (team request; idea from Blackhole 102 and Andrei25Ciuta/SPHEREx)

- Segmented control: **All** · **Short (D1–3, 0.75–2.4 µm)** · **Long (D4–6, 2.4–5 µm)** · **Longest (D5–6, 3.8–5 µm)** · single detector D1…D6. Detector ranges come from `spectral_bands.NOMINAL_RANGE`.
- Rebuild each frame **in the browser** from the per-exposure planes (section 6.2) using only the chosen detectors. Use the same method as `build_frame`: each plane in S/N units, then a 3σ-clipped mean.
  - With fewer than 3 planes in a frame, use a plain mean and show "Fewer than 3 images: cosmic-ray hits may show."
  - Keep **one shared stretch** across frames.
- Why it matters: every burst sees one short and one long detector (pairs D1+D4, D2+D5, D3+D6). Very cold objects such as WISE 0855 only show up at long wavelengths.
- Hidden in PNG-fallback spots. In quick look, it filters which exposures are downloaded.

### 8.18 Overlays: known asteroids and catalog stars (team request; idea from Andrei25Ciuta/SPHEREx)

- **Known asteroids & comets:** amber diamonds at JPL's predicted position **for each frame's date**, outlined in that frame's time color, with the name on hover. Data: SB Identification API results pre-made in `catalog/<slug>.json` (6.5), or fetched live in quick look.
- **Catalog stars:** teal rings for Gaia DR3 and SIMBAD objects, moved to each frame's date with their proper motion. Stars moving more than 1″/yr also get their name and a short path line.
- **Spoiler rule:** both overlays are locked during a round. They are available after Submit, in free explore, and in quick look. `/api/overlay?mode=round` returns nothing.
- **Tutorial:** one short step in level 1 (the asteroid diamonds land on Eros) and one in level 4 (star rings), as in section 8.13.

### 8.19 Status page (team request; idea from Driftnet)

- `/status` lists every outside service with a green/amber/red light, response time, and "last checked":
  - IRSA SIA, IRSA S3 (a `HEAD` on one known file), CDS Sesame, CDS HiPS (the SPHEREx HiPS `properties` file), SIMBAD TAP, Gaia TAP, JPL Horizons, JPL SB Identification, Supabase
- `/api/health` checks them in parallel with a 5 s timeout and caches the results for 60 s, so the services are not overloaded.
- The app uses this to explain failures in plain words, for example: "IRSA is not answering right now. Ready spots still work; quick look may fail." The footer light links here.

### 8.20 Quick look: any coordinate, live, with partial downloads (team request; ideas from Blackhole 102, Cosmic Time Machine, and Driftnet)

**Flow:**
1. `GET /api/quicklook/list?ra=&dec=` (server).
   - Query IRSA SIA for SPHEREx images that cover the position. Return, per exposure: time, detector, `obs_id`, and the S3 key from the `cloud_access` column (fall back to the `access_url` path).
   - Group exposures into bursts, like `group_bursts` (15-minute gap).
   - Retry with backoff for up to ~45 s, because IRSA's SIA often answers 502 and other teams logged many failures on Nov 14. Cache each answer for a day.
2. A **Web Worker** in the browser picks the bursts with the player's Frames & spacing settings (8.9) and the wavelength switch (8.17), using 3–4 exposures per burst. For each exposure it:
   - reads the FITS header blocks with `Range` requests (2880-byte blocks until `END`)
   - finds the IMAGE HDU's data offset
   - reads **only the rows that cover the small grid** (default 41×41 px ≈ 4.2′)
   - takes those rows from the S3 bucket directly. If CORS blocks this, use a Vercel proxy route that passes the `Range` header through.

   If an HDU is tile-compressed (`ZIMAGE = T`), skip it rather than decoding it. The team's own `spectral_bands.py` already reads headers with Range requests (`fetch(byte_range=...)`), so mirror its logic.

   For the along-path spectrum, also read the small wavelength lookup-table HDU (the spectral WCS, key `W`) to get each exposure's wavelength at the target. If that fails, skip the spectrum, not the view.
3. Map our north-up TAN grid to each exposure's pixels with **TAN-SIP**. SPHEREx headers carry SIP terms without the `-SIP` suffix, so apply them anyway. Then:
   - resample bilinearly
   - subtract each plane's median background
   - divide by its robust noise
   - combine each burst with a 3σ-clipped mean
4. Show it in the same field viewer with all image tools, overlays (live JPL + Gaia), Inspect (A, B, and a partial "along its path" spectrum), marking, and Submit.
   - **No points.** Submit runs `sb_ident`. A match says "Matches known asteroid X." Otherwise the mark is saved as a candidate and counts in the Finds layer.

**Labels, always visible:** "Quick look: live and unmasked. Bad pixels and cosmic-ray hits are not removed. Rough numbers only."

**Budget:**
- Show the planned download size before starting, for example "~6 MB, about 20 exposures."
- Show an ASCII progress bar while downloading.
- Cancel cleanly when the player leaves. Cache downloaded rows in memory.

**Checks (section 16):** the browser's TAN-SIP must match astropy within 0.01 px on 3 files, and the Range-read pixels must equal IRSA's own cutout service for the same file and area.

## 9. Draft functions (TypeScript unless noted)

```ts
// lib/coords.ts
parseCoordinates(input: string): { ra: number; dec: number } | { name: string } | { error: string }
formatRA(deg: number): string            // "08h55m10.83s"
formatDec(deg: number): string           // "−07°14′42.5″"

// lib/wcs.ts  (gnomonic TAN, north up, east left, rows top-down)
type SimpleWcs = { crval: [number, number]; crpix: [number, number]; cdelt: [number, number] }
pixelToSky(w: SimpleWcs, x: number, y: number): { ra: number; dec: number }
skyToPixel(w: SimpleWcs, ra: number, dec: number): { x: number; y: number }

// lib/fields.ts  (level of detail + preload)
loadFieldIndex(): Promise<FieldSummary[]>
loadField(slug: string): Promise<Field>                       // field.json
loadThumbs(field: Field): Promise<ImageBitmap[]>              // low detail first
loadFrames(field: Field): Promise<Float32Array[]>             // decode u16 → S/N floats
prefetchField(slug: string): void                             // idle-time prefetch

// lib/framePicker.ts
pickFrames(pool: FrameMeta[], o: { count: number; spacing: 'even' | 'growing'; minGapHours: number; startIndex?: number }): number[]

// lib/imaging.ts  (pure functions on Float32Array + width/height)
makeSharedStretch(frames: Float32Array[], o?: { blackSigma?: number; softSigma?: number }): (f: Float32Array) => Float32Array
colorByTime(grays: Float32Array[], colors: RGB[], gain?: number): Uint8ClampedArray     // onion_dark
paperMode(grays: Float32Array[], colors: RGB[]): Uint8ClampedArray                       // onion_light
onlyChanges(frames: Float32Array[]): Float32Array[]                                       // residuals
removeGlow(f: Float32Array, w: number, h: number, radius?: number): Float32Array          // white top-hat
makeDotsBigger(f: Float32Array, w: number, h: number, radius?: number): Float32Array      // dilation
followAndStack(frames: Float32Array[], tDays: number[], vx: number, vy: number, w: number, h: number): Float32Array
toImageData(px: Uint8ClampedArray | Float32Array, w: number, h: number): ImageData

// lib/palettes.ts
type Vision = 'normal' | 'protan' | 'deutan' | 'tritan' | 'mono'
timeColors(n: number, vision: Vision): RGB[]
simulateCvd(c: RGB, vision: Vision): RGB          // for tests

// lib/marks.ts
fitTrack(m: { frame: number; x: number; y: number; tDays: number }[]): { x0: number; y0: number; vx: number; vy: number; rms: number }
isStatic(t: Track, tolPx?: number): boolean
rateArcsecPerHour(t: Track, pixelArcsec?: number): number
distanceHint(rate: number): { label: string; similarTo: string }

// lib/healpix.ts
hpxNest(ra: number, dec: number, order?: number): number      // default order 12 (~0.86′ cells)
parent(ipix: number, fromOrder: number, toOrder: number): number   // ipix >> 2*(from−to)
cellCorners(ipix: number, order: number): [number, number][]

// lib/inspect.ts
loadSpectrumAt(field: Field, x: number, y: number): Promise<{ wl: number[]; flux: number[]; err: number[]; det: number[] } | null> // loads one tile
colorHint(spec: Spectrum, spotStars: Spectrum[]): 'bluer' | 'typical' | 'redder' | null
findFeatures(spec: Spectrum): { feature: 'H2O' | 'CO2' | 'CO' | 'PAH'; sigma: number }[]                 // only ≥ 3σ
lightCurveAt(frames: Float32Array[], x: number, y: number, w: number): { snr: number[]; verdict: 'steady' | 'changed' | 'faint'; frame?: number }
parallaxDistance(plxMas: number, plxOverErr: number): { pc: number; ly: number } | null                    // null if ratio < 5
redshiftDistance(z: number): { lightTravelGly: number }                                                     // Planck 2018
eclipticLatitude(ra: number, dec: number): number
toPlainType(simbadOtype: string): string                                                                    // "BD*" → "Brown dwarf"

// lib/spectra.ts  (rainbow chart, compare, temperature)
wavelengthColor(um: number): RGB                                       // violet (0.75) → red (5.0); gray in 'mono' vision
spectrumAlongPath(exps: ExposurePlanes, track: Track, apPx?: number): { wl: number[]; mJy: number[]; err: number[]; t: number[] }
matchReferences(spec: Spectrum, refs: Reference[]): { best: Match; runnerUp: Match; quality: 'good' | 'rough' | 'poor' } | null  // null if too faint
blackbodyFit(spec: Spectrum): { teffK: number; lowerLimitOnly: boolean }
temperatureGuess(m: Match, sptTeff: SptTeffTable): { approxK: number; from: string } | null   // null for movers

// lib/fits.ts + lib/sipwcs.ts  (quick look; runs inside workers/quicklook.ts)
readHeaders(url: string): Promise<{ hdus: HduInfo[] }>                 // Range reads, 2880-byte blocks
readRows(url: string, hdu: HduInfo, y0: number, y1: number): Promise<Float32Array>   // big-endian float32 → native
sipWorldToPixel(h: FitsHeader, ra: number, dec: number): { x: number; y: number }   // TAN + SIP

// lib/quicklook.ts
planQuickLook(list: ExposureMeta[], o: { frames: number; spacing: 'even' | 'growing'; minGapHours: number; detectors: number[]; gridPx?: number }): { exposures: ExposureMeta[]; bytes: number }
runQuickLook(plan: Plan, onProgress: (p: number) => void, signal: AbortSignal): Promise<QuickLookField>

// lib/overlays.ts
overlayFor(slugOrQuickLook: string, mode: 'round' | 'explore'): Promise<{ asteroids: PathPoint[][]; stars: StarRing[] }>

// lib/scoring.ts (server only)
checkSubmission(slug: string, track: Track | 'nothing'): Promise<Verdict>
pointsFor(v: Verdict, difficulty: Difficulty, firstFinder: boolean): number
```

Route handlers (validate every input with `zod`; rate-limit lightly):
`GET /api/resolve?name=` · `POST /api/check` · `GET /api/info?spot=&x=&y=&ra=&dec=&mode=round|explore` · `GET /api/overlay?spot=|ra=&dec=&mjd=…&mode=` · `GET /api/quicklook/list?ra=&dec=` · `GET /api/s3range?key=` (only if CORS blocks direct reads; whitelist the `nasa-irsa-spherex` bucket only) · `GET /api/health` · `POST /api/complete` · `GET /api/density?layer=finds|checked&order=&who=me|all` · `GET /api/leaderboard?scope=spot|all&slug=` · `POST /api/request-spot` · `GET /api/keepalive` (cron, protected with `CRON_SECRET`).

Python (`pipeline/`): `export_field(folder, slug, title, difficulty, out_dir, track=None, star=None) -> dict`, `frames_from_fits(folder)`, `frames_from_png(folder, fov)`, `answer_key(folder, wcs, mjds, track=None, star=None)`, `write_u16(frames, path) -> (scale, offset)`, `make_thumbs(frames, out_dir, size=48)`, `build_pool(ra, dec, fov, start, end, detectors=None, max_bursts=16)`, `export_spectrum_tiles(bands_folder, out_dir, tile=32)`, `catalog_facts(ra, dec, fov, mjds, track=None) -> dict` (SIMBAD + Gaia cones moved to each date, Horizons r/Δ, SB Identification per frame), `export_exposures(folder, sky, out_dir) -> dict` (per-exposure planes + wavelength maps), `convert_spiff_templates(joblib_path, out_json)` (section 6.6; ask first).

## 10. Database (Supabase Postgres)

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text unique not null check (char_length(display_name) between 3 and 20),
  created_at timestamptz default now()
);
create table finds (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade,
  spot_slug text not null,
  ra double precision not null, dec double precision not null,
  hpx12 bigint not null,                       -- HEALPix NESTED, order 12
  x real, y real, vx_px_day real, vy_px_day real,
  verdict text not null check (verdict in ('known','bot_match','candidate','static','nothing_correct','nothing_wrong')),
  object_name text, points int not null default 0,
  created_at timestamptz default now()
);
create table visits (                          -- the "Checked" layer
  user_id uuid references auth.users on delete cascade,
  spot_slug text not null, hpx12 bigint not null, created_at timestamptz default now(),
  primary key (user_id, spot_slug)
);
create table spot_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users, ra double precision, dec double precision, fov real,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  created_at timestamptz default now()
);
create index on finds (hpx12); create index on finds (user_id); create index on visits (hpx12);
```

- **RLS on every table.** Users can read their own rows. Public reads go through views or RPC functions for the leaderboard and density counts (no emails, no user ids).
- **Only the server inserts into `finds`** (service role inside `/api/check`), so nobody can give themselves points.
- **Hierarchical density:** `select (hpx12 >> (2*(12-$order))) as ipix, count(*) from finds group by 1`. The same query works for `visits`. In NESTED order, a parent index is the child index shifted right by 2 bits per level, so one stored order serves every zoom level.
- Put the SQL in `supabase/migrations/` and follow the `supabase-postgres-best-practices` skill.

## 11. Performance: level of detail, preload, small encoding, P3 color

- **Level of detail:** the sky map uses HiPS tiles (handled by Aladin). The field view loads 48 px WebP thumbnails first, then the Uint16 frames. Spectrum tiles load only when Inspect first touches them. While Inspect is on, prefetch the tile under the cursor.
- **Preload:** while the player is in a spot, use idle time (`requestIdleCallback`) to prefetch the next tutorial level and the 3 nearest ready spots. Serve `/fields/*` with long-lived immutable cache headers (hashed file names).
- **Smaller encoding:** Uint16 quantization (half the size of float32) plus Vercel's brotli compression, and WebP thumbnails. Lazy-load Aladin Lite only when the sky map opens. Keep first-load JS small; check it with `next build` output.
- **P3 color management:**
  - Define UI accents as CSS variables with sRGB defaults, plus `@media (color-gamut: p3)` overrides using `color(display-p3 …)`.
  - For canvases, try `getContext('2d', { colorSpace: 'display-p3' })` in try/catch and confirm with `getContextAttributes().colorSpace`. Chrome and Safari support it; Firefox does not, so fall back to sRGB.
  - Use P3 **only for UI accents and the density heat map.** Science colors (Okabe–Ito time colors) keep their defined values; boosting their saturation would break the color-blind-tested palette.
- Compute composites on the main thread first (the images are tiny). Move them to a Web Worker only if profiling shows jank.
- **Quick look always runs in a Web Worker.** Download at most 4 files at a time, show the byte budget up front, and stop downloading when the player leaves. Per-exposure planes for ready spots (≈1 MB) load only when the wavelength switch or a mover spectrum first needs them.

## 12. Design system

**Direction:** "blueprint terminal." This merges cyberpunk, Y2K, blueprint, industrial design, Japanese minimalism, deconstructivism, terminal, retro-futurism, and ASCII into one look instead of nine competing ones. Load the `frontend-design` skill first.

- **Japanese minimalism is the base:** lots of empty space around the viewport, one strong accent per screen, quiet motion, thin 1 px lines. Do not add decorative Japanese text.
- **Blueprint:** a dark navy background with a faint two-level grid (8 px / 40 px) drawn in CSS gradients, plus dimension-line details on panel edges.
- **Terminal + ASCII:**
  - monospace readouts and a blinking caret in the coordinate box
  - ASCII progress bars `[#####-----] 52%`, ASCII logo, and ASCII empty states
  - a bottom status line, like a terminal UI
- **Industrial:** corner brackets, panel "part numbers" (`PNL-02 // IMAGE TOOLS`), hazard stripes only on experimental or Tier 2 features.
- **Cyberpunk / Y2K / retro-futurism (sparingly):** neon cyan and magenta accents, a chrome gradient on the title only, pill buttons with a thin highlight. The scanline overlay can be turned off and is off when `prefers-reduced-motion` is set.
- **Deconstructivism (decor only):** slightly offset panel frames and broken border corners. Never on controls or text blocks.
- **Science viewport rule:** neutral black. No glow, scanlines, tint, or overlapping UI on the image. The only colors in the image come from the data and the time palette.

Tokens (sRGB fallback / P3):
```css
--bg-0:#04060b; --bg-1:#0a0f1a; --grid:#12304d; --line:#2a4a6b;
--text:#d7e3f4; --text-dim:#8fa3bd;                              /* body text contrast ≥ 4.5:1 */
--cyan:#00e1ff;    /* p3: color(display-p3 0 0.88 1) */
--magenta:#ff2e88; /* p3: color(display-p3 1 0.18 0.55) */
--amber:#ffb000;   /* p3: color(display-p3 1 0.7 0) — warnings, hazard stripes */
```

**Type:** Orbitron 500–800 for headings, buttons, and panel titles (uppercase, letter-spacing 0.08em). JetBrains Mono for coordinates, times, the scoreboard, and tutorial text. Orbitron's wide letters make numbers in tables hard to read.

Run the `web-design-guidelines` review at the end. Fix keyboard focus, labels, and contrast.

## 13. Copyright, licenses, credits, and Space Apps rules

- **Never ship anything from the wireframe.** It is reference only. Specifically:
  - the Milky Way picture
  - the scoreboard screenshot (it shows real players' usernames, which is also a privacy problem)
  - the video-editor screenshot with cartoon film frames
  - the rocket emoji graphic and the Canva button art

  Build every UI piece in code. Use only Lucide icons and your own SVGs.
- **No NASA insignia, "meatball," "worm" logotype, or mission logos** anywhere: not in the favicon, the UI, or generated art. The product name must not suggest NASA endorses it. Plain text like "Built for the 2026 NASA Space Apps Challenge" is fine.
- **Data credits in `CREDITS.md` and `/credits`:**
  - Copy the **exact SPHEREx acknowledgment** from IRSA's SPHEREx mission page, the **IRSA acknowledgment** from IRSA's "Acknowledging IRSA" page, and the **DOI** of the release used (QR2 is `10.26131/IRSA652`; look up the DR1 DOI on IRSA's site). Fetch the current wording; do not write it from memory.
  - CDS: Aladin Lite (GPL-3.0), the SPHEREx HiPS (ODbL; follow CDS's licence page), and Sesame/SIMBAD.
  - JPL Solar System Dynamics: Horizons and SB Identification API.
  - **SIMBAD and Gaia DR3** acknowledgments (required, because Inspect and the overlays use them): copy CDS's SIMBAD acknowledgment sentence and the Gaia DR3 credit text from their official pages. Fetch the wording; don't write it from memory.
  - astropy, astroquery, photutils, numpy, scipy.
  - Okabe & Ito palette, Lupton et al. asinh stretch, Heinze et al. 2015, Whidden et al. 2019.
  - Every npm production dependency.
  - **AWS Open Data / IRSA cloud:** SPHEREx files read from the `nasa-irsa-spherex` S3 bucket. Credit IRSA and the Registry of Open Data on AWS, using the "How to cite" wording on the dataset's registry page.
  - **SPIFF** (Gagné et al. 2026, arXiv:2604.22012; github.com/jgagneastro/SPIFF; MIT). Keep its MIT license text with the converted templates, and cite the paper.
  - **Mamajek's dwarf color/Teff table**, citing Pecaut & Mamajek (2013, ApJS 208, 9) as the table asks. The table's author also asks users to email him; tell the team.
- **Acknowledge every outside thing (team rule).** Every dataset, API, library, font, icon set, paper, method, and **borrowed idea** gets one row in `CREDITS.md`: name, author, link, license, what we used it for, and the date checked. It must also appear on `/credits` and in a short README "Acknowledgments" section. When unsure, add the row.
- **Ideas borrowed from other Space Apps 2026 projects (credit by name; no code copied):**

  | Project | Team / author | Link | License | Idea we used |
  | --- | --- | --- | --- | --- |
  | SPHEREx Blink | Andrei25Ciuta (LICENSE names mateibut; a practice project, per its README) | github.com/Andrei25Ciuta/SPHEREx | MIT | wavelength / detector picker; known-asteroid and catalog-star overlays moved to each frame's date; spectrum along a mover's path |
  | Blackhole 102 | FearmessOp | github.com/FearmessOp/blackhole-spherex · blackhole-spherex.vercel.app | Apache-2.0 | short/long detector selection; browser quick look from the public cloud copy with Range reads; checking browser TAN-SIP against astropy |
  | Cosmic Time Machine | Newstein123 | github.com/Newstein123/nasa-app-challengev1 | none stated | reading only the needed rows with Range requests; checking pixels against IRSA's cutout service |
  | Driftnet | epsretriever | github.com/epsretriever/spherex-planet-x · driftnet-sky.vercel.app | MIT | the live service status page; reading from the `nasa-irsa-spherex` bucket |
  | Cipher-X Omega | Cipher-X Crew | github.com/sanaasif1217/cipher-x-crew-spherex · sanaasif1217.github.io/cipher-x-crew-spherex | none stated | a mover's spectral trace across the detector |

  Write this table into `CREDITS.md` and `docs/DECISIONS.md`, with the sentence "We read these projects for ideas; all code here is our own."
- **Reference screenshot:** the team's brown-dwarf spectrum screenshot is a style reference only. Its credit line names Zafar Rustamkulov / International Gemini Observatory / NOIRLab/NSF/AURA, M.H. Wong (UC Berkeley) et al. **Do not copy it, trace it, or use its planet images.** Draw our own chart from our own data.
- **Space Apps rules:** the participant terms say every resource used must be cited, even open-source ones. The project-submission guide (2025 edition; check for a 2026 update) says to state where and how AI tools were used, and that AI-generated images or video need a visible "AI-generated" watermark.
  - Add a **"How we used AI"** section to the README and `/about`, saying that Claude Code helped write the code.
  - **Do not generate AI images.** Use real SPHEREx data and CSS/SVG.
- **License:** add `LICENSE` (GPL-3.0) at the repo root (team decision) and keep license notices for Lucide (ISC) and the fonts (OFL).
- Run the repo's **`asset-license-audit`** skill before every production deploy. In the npm `--onlyAllow` check, list `aladin-lite` (GPL-3.0) as an approved exception. The team accepted GPL.

## 14. Changes from the wireframe and why (keep this section in `docs/DECISIONS.md`)

| Change | Why |
| --- | --- |
| "OpenCV tools" → **"Image tools,"** built in TypeScript | Normal players don't know what OpenCV is. OpenCV.js is ~11 MB for six simple operations on 119×119 images. |
| Removed blur/smoothing tools | The team's own test: smoothing (the matched filter) **lowered** faint-object S/N to 0.56–0.81×. Max-combining and RMT denoising also hurt (README). |
| Color-blind **checkboxes → one choice**, plus "No color" | A person has one type. Checkboxes allow combinations that mean nothing. |
| Brightness labels "Giant planet / Saturn planet / White-dwarf planet" → **Eros / Hektor / Makemake / Eris** | A "white-dwarf planet" is not a real type of object, and brightness depends on size and distance, not type. The new labels are real objects the team measured. |
| Timeline "Brightness" and "Size" keyframe lanes → **"My marks" and "Answers"** lanes | Changing brightness per frame breaks the "same stretch for every frame" rule, so stars would flicker and look like movers. "Size" has no meaning for fixed-pixel science images. |
| Settings gear → plain **"Show me at top"** toggle | One clear control instead of a hidden menu. |
| Frames capped at **2–7** for Color by time | The color-blind-safe palette has 7 colors that add up to white. Blink can use more. |
| Frame times **snap to real moments** | SPHEREx only visits a spot at certain times. |
| P3 color only for UI and the heat map | Making the science colors more vivid would break their color-blind testing. |
| Added **guest play** | Judges won't create accounts. Login still saves finds. |
| Added **"Nothing moved here"** + the Cygnus level | Teaches that an empty answer can be correct and stops random clicking. |
| Added the **bot** to the scoreboard | Reuses `shift_stack.py` results, makes "Beat the Bot" real, and shows honest noise bars. |
| Added the **challenge test targets** (Barnard's Star, ε Indi B, WISE 0855, RW Aur, R Dra) | The brief says to test on them. Star motion needs months-apart frames, which is a good use of Growing spacing. |
| Added **URL coordinates + `/embed`** | Suggested in the brief. |
| Added a **request queue** for full processing | Vercel functions stop at 300 s, and the Python pipeline takes minutes per spot with a flaky IRSA. Quick look covers live viewing; full processing stays on the laptop. |
| Added **keep-alive + offline fallback** | Free Supabase projects pause after 1 week idle, and judging runs into Dec–Jan. |
| **Blink capped at 3 per second** + reduced motion | Flashing safety. |
| Added a **monospace font** next to Orbitron | Orbitron is wide and hard to read in number tables. |
| Distance hint uses **measured comparisons**, not the CLAUDE.md formula | The formula is for opposition. SPHEREx looks sideways from the Sun, so the formula is ~4× off for Eris. |
| Added the **Inspect** popup (team request), opened with a **toggle** | Clicking already marks movers. A toggle keeps marking fast and still makes the popup easy to find. |
| Inspect names and distances **locked until Submit** | Catalogs would give away the answer mid-round. Unlocking them becomes the reward. |
| Inspect shows **no age** and no "exact" chemical amounts. Star distances come from **Gaia, not SPHEREx**. | These can't be measured honestly from this data. Even Barnard's Star's parallax is under a tenth of a pixel. |
| Inspect spectra come from **pre-made cubes**, not live from IRSA | IRSA's spectrum tool is queue-based and slow. Pre-made cubes keep working during judging. |
| Added a **live quick look** for any coordinate, with **no points** there | Other teams showed that partial downloads make live viewing possible without Python. There is no answer key and no bad-pixel masking, so scoring there would be unfair. |
| Added the **wavelength switch** | Cold objects such as WISE 0855 only appear at long wavelengths, and every burst mixes a short and a long detector. |
| Added **overlays**, locked during rounds | They show JPL and catalog facts on the image, but would give answers away mid-round. |
| Added a **status page** | IRSA often fails. Players should see why something isn't loading instead of a blank screen. |
| Spectrum as a **rainbow chart** with "looks most like…" and a temperature guess | The team asked for it. The rainbow is decoration only, the match needs enough signal, and the temperature is always "approx." with no age. Movers get no temperature. |
| Other teams' work: **ideas only, credited by name** | Keeps the code original for judging, and the Space Apps terms require citing every resource. |
| **PR #1 M101 frames not used in the game** | They are single exposures at different wavelengths, so stars change brightness between frames and create false "changes." M101 is a galaxy, so nothing in it moves. |

## 15. Build order, time boxes, and cut list (Bangkok time)

| Window | Phase | Done when |
| --- | --- | --- |
| now → 04:00 | **0 Setup** | Branch `web`; Next.js in `web/`; tokens + fonts; `export_web.py` writes all 5 spots (PNG fallback is fine); first **preview** deploy. |
| 04:00 → 08:00 | **1 MVP (the safety-net demo)** | Field viewer, shared stretch, blink, Color by time, Show only changes, brightness slider, timeline, marking + local check against answer keys, tutorial levels 0–1, guest mode. Preview deploy. |
| 08:00 → 12:00 | **2 Explore** | Aladin sky map + SPHEREx HiPS + spot markers; coordinate box + Sesame + URL state; remaining image tools; color vision modes + palette test; Frames & spacing; tutorial levels 2–5; **Inspect sections A, B, F** (no network needed); **wavelength switch** (once `exposures.u16` is exported); **`/status` + `/api/health`**. |
| 12:00 → 16:00 | **3 Accounts** | Supabase auth, `/api/check` on the server, finds/visits, scoreboard + bot row, density layers, request queue, keep-alive cron; **`/api/info` + Inspect D, E, G with the server-side spoiler lock**; **overlays** + their tutorial steps; **quick look** steps 1–3 (list, Range reads, TAN-SIP, checked against astropy). |
| 16:00 → 19:00 | **4 Polish** | Star targets (if exported), **Inspect C spectrum view**: rainbow chart, along-path spectrum, compare + temperature (once the cubes and references exist); **quick look** step 4 (marking + `sb_ident` check); full `CREDITS.md` with every row from section 13; design pass, credits/LICENSE/README/AI section, license audit, mobile basics. |
| **19:00** | **Feature freeze** | Bug fixes only from here. |
| 19:00 → 21:00 | **5 Ship** | Tests (section 16), ask the team, then **production deploy**. Write `docs/DEMO.md`: a 30-second demo script with English subtitles, or ≤7 slides (check the 2026 submission guide). |
| 21:00 → 22:00 | Buffer | Team submits. |

**If late, cut in this order:** Follow & stack → distance hint → spectrum hints (color, dips) → star-target spots → `build_pool` → mobile layout → realtime scoreboard refresh → P3 canvas (keep the CSS P3) → density at many zoom levels (keep one) → live Inspect lookups on the sky map (keep the pre-made ready-spot facts) → temperature guess → compare to types (keep the rainbow chart) → quick-look marking (keep the quick-look viewer).

**Never cut:** the tutorial's first two levels, guest play, credits and acknowledgments, or the "Nothing moved" answer.

## 16. Testing and checks

- **Unit tests (vitest):**
  - coordinate parser (all formats, bad input)
  - `pickFrames` (even and growing, snapping, no repeats)
  - `colorByTime` (a still star → white)
  - `onlyChanges` (a still star → ~0)
  - palette color-blind test
  - HEALPix parent math
  - `fitTrack` / `isStatic`
  - `parallaxDistance(500, 100)` → 2 pc ≈ 6.52 ly; returns `null` when the ratio is < 5
  - `redshiftDistance(0.01)` → ≈ 0.14 billion ly
  - `findFeatures` reports nothing on a flat, noisy spectrum
  - `/api/info?mode=round` never returns a name, type, distance, or JPL result
  - `/api/overlay?mode=round` returns nothing
  - `wavelengthColor` is monotonic from violet to red, and returns gray in `mono` vision
  - `matchReferences` on a SPIFF template returns that same type as "good"; it returns `null` for a spectrum below S/N 5
  - `blackbodyFit` recovers 3000 K ± 10% on a synthetic 3000 K curve sampled at SPHEREx wavelengths; at 8000 K it reports a lower limit
  - `temperatureGuess` returns `null` for movers
  - `spectrumAlongPath` on Eros (per-exposure planes + JPL track) returns one point per exposure that covers it
  - `planQuickLook` stays under the byte budget and respects the detector filter
- **Quick look checks:** TAN-SIP in the browser vs astropy ≤ 0.01 px on 3 real files. Range-read pixels equal IRSA's cutout service for the same file and area. Commit a small fixture so the test runs offline.
- **Overlay check:** on Eros, the JPL diamonds fall within 2 px of the answer-key positions in every frame.
- **Credits check:** every package in `package.json`, every API in section 7, every file in `public/ref/`, and every project in the section 13 ideas table has a row in `CREDITS.md`. A small script fails the build if one is missing.
- **Science check:** your client-side Color by time for Eros must look like the repo's `onion_dark.png`. Downsample both and require a correlation of at least 0.9. Cygnus must have **no** bot candidates above the noise bar (all `False` in `candidates.csv`).
- **End-to-end (`webapp-testing`, Playwright):**
  - tutorial levels 0–1 finish when the answer-key positions are clicked
  - guest mode works with **no** Supabase environment variables
  - the coordinate box resolves "Barnard's Star"
  - `/play?ra=…&dec=…` restores the view
  - the scoreboard collapses and expands
  - in tutorial level 1, Inspect shows `[LOCKED]` before Submit and "(433) Eros" plus a distance after it
  - in tutorial level 1, the overlay step shows diamonds on Eros after Submit
  - `/status` lists every service with a light
  - quick look at WISE 0855's coordinates loads a blinkable view with the "live and unmasked" label (skip in CI if IRSA is down; the status page should say so)
- **Quality:** keyboard-only playthrough of level 1, contrast check, no console errors. Lighthouse on desktop: performance ≥ 80, accessibility ≥ 90.

## 17. Deploy

Follow the `deploy-to-vercel` skill. Deploy **previews** while working. **Ask the team once** before the first **production** deploy, then use production for the demo URL. Set the Vercel project root to `web/`. Add the env vars and the daily cron in `vercel.json` (`/api/keepalive`). After deploy, open the live URL and repeat the end-to-end checks against it.

## 18. Do not

- Change the signatures of existing Python functions, or put back the rejected methods (matched filter as default, RMT denoise, max-combine).
- Claim a detection without its noise bar, or invent data, positions, or results.
- Use NASA logos, wireframe pictures, AI-generated images, or hotlinked media.
- Commit secrets or `.env` files. Expose the service key to the browser. Let clients write points.
- Push to `main` or deploy to production without asking.

## 19. Definition of done

- [ ] Public Vercel URL. The title screen leads to the tutorial (levels 0–5), and free play works as a guest.
- [ ] 5 ready spots playable; challenge test targets added if exported.
- [ ] Sky map with SPHEREx HiPS, coordinate box (degrees, sexagesimal, names), URL state, request queue.
- [ ] Image tools, color vision modes (palette test passing), brightness landmarks, timeline, Frames & spacing.
- [ ] Login/signup, server-side scoring, scoreboard with "show me at top" and the bot, two density layers with my/others toggles.
- [ ] Inspect popup: where, over time, spectrum (for spots with cubes), catalog facts and distances with the server-side spoiler lock, sources on every number, and the "can't tell from here" line.
- [ ] Rainbow spectrum chart with molecule bands, the along-path spectrum for movers, "looks most like…", and an approximate temperature (none for movers).
- [ ] Wavelength switch, known-asteroid + catalog-star overlays (locked during rounds, shown in tutorial levels 1 and 4), and the `/status` page.
- [ ] Quick look at any coordinate: live partial downloads, the "unmasked" label, marking checked by `sb_ident`, and no points.
- [ ] `CREDITS.md`, `/credits`, and the README Acknowledgments list every dataset, API, library, paper, and borrowed idea (including the other teams' table); the credits check passes.
- [ ] `CREDITS.md` + `/credits`, `LICENSE` (GPL-3.0), README "Website" + "How we used AI" sections, `docs/DECISIONS.md`, `docs/DEMO.md`, CLAUDE.md updated with a short web section.
- [ ] License audit: zero blockers. Tests green. Live URL checked.
