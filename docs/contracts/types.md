# Contract: shared TypeScript types

Owner: GAME. Source of truth: `web/lib/types.ts` (this file explains it). Change only through a `contract` issue (coordination 3.5).

Conventions used by every type:
- Pixel coordinates `x, y` are on the field's native grid, **rows top-down**, origin at the top-left pixel centre (0, 0). Never FITS bottom-up.
- Sky coordinates are ICRS decimal degrees. Times are MJD (days, UTC) plus an ISO `utc` string for display.
- Image values in the browser are S/N floats (`Float32Array`, length `H*W`, row-major top-down), decoded from `frames.u16` as `S/N = value * scale + offset`.

| Type | What it is | Produced by | Consumed by |
| --- | --- | --- | --- |
| `RGB` | `[r, g, b]`, 0 to 255 each | palettes | imaging, UI |
| `Vision` | `normal`, `protan`, `deutan`, `tritan`, `mono` | VisionPicker | palettes, spectra |
| `Difficulty` | `easy`, `medium`, `hard`, `boss`, `expert`, `control` | field.json | scoring, UI |
| `FieldKind` | `asteroid`, `dwarf-planet`, `control`, `star`, `fixture` (DATA's field.json values), plus browser-only `quicklook` | field.json | UI |
| `FrameMeta` | one burst: index `i`, `mjd`, `utc`, `hours_since_prev`, `n_bands`, `detectors` | field.json `frames[]` | timeline, framePicker, marks |
| `FieldWcs` | gnomonic TAN, `crval`, `crpix` (1-based, bottom-up, exactly FITS; top-down reference pixel is `(crpix[0]-1, H-crpix[1])`), `cdelt` deg/px | field.json `wcs` | wcs.ts |
| `FieldData` | `frames.u16` encoding: `scale`, `offset`, `units: "S/N"`, `precision: "float" or "png8"`, `nodata` (65535, decodes to NaN) | field.json `data` | fields.ts |
| `FieldHas` | optional files present: `exposures`, `spectrum`; missing key = false | field.json `has` | WavelengthSwitch, Inspect |
| `FieldStretch` | shared display stretch: `black_sigma`, `soft_sigma`, `white` | field.json `stretch` | imaging.ts |
| `Field` | full `field.json` (BP 6.2) | DATA export | everyone |
| `FieldSummary` | one row of `fields/index.json` | DATA export | title page, sky map |
| `Mark` | one player click: `frame`, `x`, `y`, `tDays` | FieldViewer | marks.ts |
| `Track` | fitted straight-line motion: `x0, y0` at `t0Days`, `vx, vy` px/day, `rms`, `marks` | marks.ts | `/api/check`, timeline |
| `CheckRequest` | body of `POST /api/check`: `spot`, `answer: "track"` with raw `marks` (frame from 1, x, y), or `answer: "nothing"`; the server fits the track (api.md 3) | GAME | SERVER |
| `CheckResponse` | `/api/check` reply: `verdict`, `first_finder`, `already_found`, `persisted`, `unlocked`, `reveal?`, `track?`, `noise_bar_sigma` | SERVER | GAME |
| `VerdictKind` | `known`, `bot_match`, `candidate`, `static`, `nothing_correct`, `nothing_wrong` | SERVER | GAME |
| `Verdict` | `{ kind, object_name?, points, message }` | `/api/check` | GAME |
| `Spectrum` | `wl` (micron), `flux` (mJy), `err`, optional `det` | inspect.ts / spectra.ts | SpectrumChart, matchReferences |
| `ExposureMeta` | one SPHEREx exposure: `obs_id`, `mjd`, `utc`, `detector`, `frame?`, `path` (IRSA/S3), `wl_um?` | exposures.json, quick look list | quicklook, WavelengthSwitch |
| `ApiError` | `{ error: { code, message, details? } }`, codes from api.md 1 | every API route | every caller |

Field details (`exposures.json`, spectrum tiles) are DATA's `field-schema.md`; request and response JSON is SERVER's `api.md`. If one of those disagrees with `types.ts`, open a `contract` issue; do not patch locally.
