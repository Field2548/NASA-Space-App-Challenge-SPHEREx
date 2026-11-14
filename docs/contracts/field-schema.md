# Contract: field schema (owner: DATA)

Version 1, published 2026-11-15 04:10 Bangkok. Change only through a `contract` issue (coordination 3.5). Version 1.1 (2026-11-15): neutral public title, kind and difficulty; `reveal` in the answer key (issue #10); `change_snr` in answer-key positions.
Every file below is written by `pipeline/export_web.py` (real spots) or `pipeline/make_fixture.py` (the `fixture` spot).

```
web/public/fields/index.json                 list of ready spots            public
web/public/fields/<slug>/field.json          one spot                       public
web/public/fields/<slug>/frames.u16          all frames, S/N                public
web/public/fields/<slug>/thumbs/<i>.webp     48x48 previews, i from 1       public
web/public/fields/<slug>/exposures.u16       single exposures (phase 2)     public, optional
web/public/fields/<slug>/exposures.json      their metadata (phase 2)       public, optional
web/public/fields/<slug>/spectrum/index.json 102-band cube index (phase 3)  public, optional
web/public/fields/<slug>/spectrum/t_<tx>_<ty>.u16  cube tiles (phase 3)     public, optional
web/data/answers/<slug>.json                 answer key                     SERVER ONLY, never public
web/data/catalog/<slug>.json                 catalog facts (phase 2)        SERVER ONLY, never public
```

## 1. Pixel grid (applies to every file)

- A spot is a `W x H` grid, `size: [W, H]`. All arrays are stored **rows top-down**: row 0 is the top (north) row, column 0 is the left (east) column. North is up, east is left.
- Pixel coordinates `(x, y)` everywhere in JSON are **0-based, top-down, pixel centres at integers**: `x` = column, `y` = row from the top. The array index of pixel `(x, y)` in a plane is `y * W + x`. Fractional values are allowed (track positions).
- Pixel scale is 6.15 arcsec (`pixel_arcsec`).
- `wcs` is a plain gnomonic (TAN) projection. `crpix` is kept **1-based, as in FITS** (so it equals `grid_wcs` in `spectral_bands.py`). The reference pixel in 0-based top-down coordinates is `(crpix[0] - 1, H - crpix[1])`. Real spots are odd-sized and centred, so that is the centre pixel (59, 59 for 119 px); the even-sized fixture has it at (15, 16). Conversion, with `(xi, eta)` the standard gnomonic coordinates in degrees (xi to the east, eta to the north):

```
x = (crpix[0] - 1) + xi  / cdelt[0]        cdelt[0] < 0  (east is left)
y = (H - crpix[1]) - eta / cdelt[1]        cdelt[1] > 0  (north is up, y grows downward)
```

## 2. `field.json`

Schema from BUILD_PROMPT 6.2, verbatim, plus the marked additions.

```json
{
  "slug": "eros", "title": "Field in Pisces", "kind": "spot", "difficulty": "easy",
  "ra": 13.2004, "dec": 14.38, "fov_deg": 0.2, "pixel_arcsec": 6.15, "size": [119, 119],
  "wcs": { "ctype": ["RA---TAN", "DEC--TAN"], "crval": [13.2004, 14.38], "crpix": [60, 60],
           "cdelt": [-0.0017083, 0.0017083], "rows": "top-down" },
  "frames": [ { "i": 1, "mjd": 60865.752824, "utc": "2025-07-09T18:04:04", "hours_since_prev": 0,
                "n_bands": 8, "detectors": [3, 6] } ],
  "data": { "format": "u16", "file": "frames.u16", "scale": 0.01, "offset": -10, "units": "S/N",
            "precision": "float", "nodata": 65535 },
  "thumbs": ["thumbs/1.webp"],
  "stretch": { "black_sigma": -1, "soft_sigma": 2, "white": 41.3 },
  "psf_fwhm_px": 1.6,
  "has": { "exposures": false, "spectrum": false }
}
```

| Key | Meaning |
| --- | --- |
| `title` | neutral on purpose: `Field in <constellation of the spot centre>`. The object's name is in the answer key only (`reveal`, section 6) |
| `kind` | `spot` for every ready spot (`fixture` for the test spot). The real kind is in the answer key only |
| `difficulty` | `easy`, `medium`, `hard`, `boss`. The control spot is listed as `medium` so it cannot be recognised; its real difficulty is in the answer key only |
| `frames[].i` | frame number, **from 1**, in time order. Plane `i - 1` of `frames.u16`. |
| `frames[].mjd` | mean time of the frame (MJD, UTC). `utc` is the same time as ISO text. |
| `frames[].hours_since_prev` | 0 for the first frame |
| `frames[].detectors` | SPHEREx detectors (1 to 6) that went into this frame, sorted |
| `data.precision` | `float` = from `frames.fits`. `png8` = recovered from the committed 8-bit previews ("preview quality"): about 250 distinct levels, clipped below `stretch.black_sigma` and above `stretch.white`. Same units and same decoding either way. |
| `data.nodata` | addition: the u16 value that means "no data" (always 65535) |
| `stretch` | the shared display stretch (`make_stretch` in `motion_frames.py`): `x = clip((S/N - black_sigma) / (white - black_sigma), 0, 1)`, `a = (white - black_sigma) / soft_sigma`, `gray = asinh(a * x) / asinh(a)`. One stretch for all frames. |
| `psf_fwhm_px` | effective star width in grid pixels |
| `has` | addition: which optional files exist for this spot. Missing key = false. Hide the wavelength switch when `exposures` is false, the spectrum view when `spectrum` is false. |

## 3. `frames.u16`

- Raw binary, no header. `N * H * W` values, **little-endian Uint16**, plane order `N x H x W` (frame, then row top-down, then column). `N = frames.length`. File size is exactly `2 * N * H * W` bytes.
- Quantize: `value = round((S/N - offset) / scale)`, clipped to `0 .. 65534`.
- Dequantize: `S/N = value * scale + offset`. Round-trip error is at most `scale / 2`.
- `65535` = no data (NaN in the source). Decode it to `NaN`.
- `scale` and `offset` are per spot (in `field.json` `data`), the same for all frames.

```ts
const u = new Uint16Array(await (await fetch(url)).arrayBuffer());   // hosts are little-endian
const frame = (k: number) => Float32Array.from(u.subarray(k * W * H, (k + 1) * W * H),
  v => v === 65535 ? NaN : v * scale + offset);
```

## 4. `thumbs/<i>.webp`

48 x 48 WebP, gray, one per frame (`i` from 1), drawn with the shared stretch, rows top-down. For the timeline only; never for science.

## 5. `index.json`

```json
[ { "slug": "eros", "title": "Field in Pisces", "ra": 13.2004, "dec": 14.38, "fov_deg": 0.2,
    "difficulty": "easy", "kind": "spot", "thumbnail": "eros/thumbs/1.webp" } ]
```

`thumbnail` is relative to `web/public/fields/`. The `fixture` spot is listed only until real spots land; after that its folder stays (tests use it) but it leaves the index.

## 6. `web/data/answers/<slug>.json` (server only)

Never import this from client code and never copy it under `public/`.

```json
{
  "slug": "eros",
  "nothing_moves": false,
  "noise_bar_sigma": null,
  "t_ref_mjd": 60866.1,
  "reveal": { "title": "(433) Eros", "kind": "asteroid", "difficulty": "easy" },
  "objects": [
    { "id": "433", "name": "433 Eros (A898 PA)", "kind": "asteroid", "source": "JPL Horizons",
      "positions": [ { "frame": 1, "x": 51.2, "y": 63.9, "in_grid": true, "snr": 721.2, "change_snr": 763.6 } ],
      "vx_px_per_day": 12.1, "vy_px_per_day": -3.4 } ],
  "bot": { "source": "shift_stack.py", "candidates": [
      { "rank": 1, "x": 30, "y": 28, "vx_px_per_day": 0.663, "vy_px_per_day": -1.245,
        "stacked_snr": 6.86, "above_noise_bar": true, "snr_per_frame": [2.2, 3.0, 2.9, 3.4, 3.8], "status": "known", "object_id": "136199", "near_object_frames": [1, 2, 3, 4, 5] } ] }
}
```

| Key | Meaning |
| --- | --- |
| `nothing_moves` | `true` for the control spot: the right answer is "Nothing moved" |
| `noise_bar_sigma` | the field's noise bar for the bot search (stacked S/N). `null` if no bot search was run. Never report a bot match without it. |
| `objects[].positions` | one entry per frame, in the top-down grid (section 1). `in_grid` is false when the object is outside the picture in that frame (Eros leaves after frame 3; `x, y` are then outside `0..W-1`). Optional `snr`: measured S/N there (max of the 3 x 3 pixels), absent when out of the grid, `null` when there is no data. Optional `change_snr`: the same 3 x 3 maximum taken in the frame minus the median of the other frames (`motion_frames.residuals`), so stars cancel. Use `change_snr`, not `snr`, to say whether the object itself is seen in a frame: `snr` also counts a background star that happens to lie under the path. |
| `objects[].v*_px_per_day` | straight-line fit to the positions of all frames, top-down (positive `vy` = moving down = south). A summary only: score against `positions`, because fast objects do not move in a straight line. |
| `reveal` | the real title, kind and difficulty of the spot (for the control spot: `control`). Public files never carry these (issue #10). The server sends them only after a correct answer |
| `bot.candidates` | from `candidates.csv`, already converted: `y = H - 1 - y_csv`, `vy = -vy_csv`. `x, y` is the position at `t_ref_mjd` (the mean of the frame times); position in frame `i` is `x + vx * (mjd_i - t_ref_mjd)`, same for y. |
| `bot.candidates[].status` | `known`: the candidate is the known object (within 3 px of it in at least 3 frames); `object_id` says which. `alias`: a wrong track that passes within 3 px of the known object in only one or two frames and borrows its light there (`near_object_frames` lists them); never score or announce it as a find. `unconfirmed`: matches no known object; above the noise bar it is an honest candidate, not a confirmed object. `above_noise_bar` is unchanged by this: it states what the search measured |

`objects` is `[]` and `bot.candidates` is `[]` when there are none.

## 7. `exposures.u16` + `exposures.json` (phase 2, optional)

`exposures.u16`: `K x H x W` little-endian Uint16, rows top-down, `65535` = no data. Each exposure has its **own** `scale` and `offset`; values are surface brightness in MJy/sr after zodiacal-light and background subtraction: `MJy/sr = value * scale + offset`. Written only for `precision: "float"` spots whose cutouts were available (`has.exposures`). About 1 MB for a 119 px spot.

```json
{
  "file": "exposures.u16", "size": [119, 119], "count": 34, "units": "MJy/sr", "nodata": 65535,
  "wavelength_grid": 8,
  "exposures": [
    { "k": 0, "frame": 1, "mjd": 60865.750596, "utc": "2025-07-09T18:00:51", "detector": 3,
      "obs_id": "2025W28_1B_0502_1", "file": "2025W28_1B_0502_1_D3.fits",
      "source": "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/...",
      "scale": 0.0006442, "offset": -0.3108, "noise": 0.012676, "clipped": false,
      "bandwidth_um": 0.0537,
      "wavelength_um": [[null, null, null, 2.1357, 2.1328, 2.1299, 2.127, 2.1241]] } ]
}
```

- `k` is the plane index in `exposures.u16`. `frame` is the frame number (from 1) this exposure belongs to. Exposures are listed frame by frame; a frame has `n_bands` of them.
- `mjd` / `utc` is the start of the exposure (`DATE-OBS`). `source` is the full IRSA image the cutout came from (provenance), or `null`.
- `noise` is the sigma-clipped standard deviation of the plane, in MJy/sr.
- `scale` is at most `noise / 2`. If the plane's range is too wide for that, the brightest pixels are clipped to `65534` and `clipped` is `true` (their real value is higher).
- `wavelength_um` is an 8 x 8 grid (8 rows top-down, each 8 columns): the wavelength seen at the centre of each of 8 x 8 equal cells of the spot. Cell `(cx, cy)` is centred on pixel `((cx + 0.5) * W / 8 - 0.5, (cy + 0.5) * H / 8 - 0.5)`. Interpolate bilinearly. `null` = the exposure does not cover that cell. `bandwidth_um` is the band width at the centre of the spot (`null` if not covered).

**Rebuilding a frame from exposures** (what the wavelength switch does; reference code is `rebuild_frame` in `pipeline/export_web.py`, the same maths as `build_frame` in `motion_frames.py`):

1. Pick the exposures of one frame that pass the filter (detector or wavelength).
2. Turn each plane into noise units: `plane / noise`.
3. Per pixel: with 3 or more planes, a 3-sigma-clipped mean (centre = median, spread = 1.4826 x median absolute deviation, repeat until nothing more is clipped); with 1 or 2 planes, the plain mean ignoring NaN (show the "fewer than 3" notice: cosmic rays are not removed).
4. Divide the result by its own noise (sigma-clipped standard deviation, 2.5 sigma, 5 rounds).
5. Blank every pixel that is NaN in any of the frames shown, then use one shared stretch.

With all exposures of a frame selected, this reproduces `frames.u16` to a median of about 0.03 sigma (tested in `pipeline/tests`).

## 8. `spectrum/index.json` + tiles (phase 3, optional)

```json
{
  "size": [119, 119], "tile": 32, "nx": 4, "ny": 4, "origin": [0, 0], "covered": [119, 119],
  "units": "MJy/sr", "nodata": 65535,
  "bands": [ { "band": 1, "detector": 1, "wavelength_um": 0.75, "bandwidth_um": 0.018,
               "date_obs": "2025-05-12T03:11:20", "scale": 0.0005, "offset": -1.0, "noise": 0.04 } ]
}
```

- Tile `t_<tx>_<ty>.u16` holds pixels `x = origin[0] + tx*32 .. +31`, `y = origin[1] + ty*32 .. +31`. Layout `B x 32 x 32` little-endian Uint16 (band, row top-down, column), `B = bands.length`. Edge tiles are padded with `65535`.
- Value of band `b` at pixel `(x, y)`: tile index `(b * 32 + (y - origin[1]) % 32) * 32 + (x - origin[0]) % 32`, then `MJy/sr = value * bands[b].scale + bands[b].offset`.
- `origin` and `covered` allow a cube smaller than the spot (the old 0.1 deg Cygnus cube covers the central 59 x 59 pixels: `origin: [30, 30]`, `covered: [59, 59]`). Outside it: "No spectrum here."
- `bands[].noise` is the sigma-clipped standard deviation over the spot, in MJy/sr.

## 9. `web/data/catalog/<slug>.json` (server only, phase 2: DRAFT)

Draft shape. It becomes final when DATA closes the `contract` issue for it (before 12:00); SERVER, comment there if you need other columns.

```json
{
  "slug": "eros",
  "frames": [ { "i": 1, "mjd": 60865.752824 } ],
  "stars": [ { "source": "gaia", "id": "Gaia DR3 2590311523446772736", "name": null, "otype": null,
               "sp_type": null, "ra": 13.21, "dec": 14.37, "pmra": 12.3, "pmdec": -4.5,
               "plx": 2.1, "plx_over_err": 14.2, "g_mag": 15.2, "bp_rp": 1.1, "rv": null, "z": null,
               "xy": [[61.2, 55.0]] } ],
  "objects": [ { "id": "433", "name": "433 Eros (A898 PA)", "r_au": [1.45], "delta_au": [0.62] } ],
  "asteroids": [ { "name": "433 Eros", "positions": [ { "frame": 1, "x": 51.2, "y": 63.9, "ra": 13.2, "dec": 14.4, "vmag": 11.9 } ] } ]
}
```

`stars[].source` is `gaia` or `simbad`. `xy` has one `[x, y]` per frame: the star's position moved to that frame's date with its proper motion. `pmra`, `pmdec` in mas/yr, `plx` in mas.

## 10. The `fixture` spot

`web/public/fields/fixture/` + `web/data/answers/fixture.json`, made by `pipeline/make_fixture.py` (deterministic, seed 42). Use it until real spots land and in unit tests after that.

- 32 x 32 px, 4 frames 3 h apart, `precision: "float"`, noise sigma 1.
- 3 static stars at `(8, 8)`, `(24, 10)`, `(12, 25)` with peak S/N 40, 25, 15.
- 1 mover with peak S/N 20 at `(10, 16)` in frame 1, moving `+2 px` in x per frame: `(12, 16)`, `(14, 16)`, `(16, 16)`.
- One pixel `(31, 31)` is no data (65535) in every frame, to exercise the NaN path.
- Its answer key has one bot candidate on the mover (`status: "known"`, `noise_bar_sigma` 6.0), so "matches the bot" paths can be tested.
