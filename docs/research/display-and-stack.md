# Display conventions and web stack: gold standard vs our plan

Checked 2026-11-15. "verified" = read on the live source this session; "unchecked" = not read, from background knowledge, confirm before relying.

## A. Astronomy image display

### A1. Stretch and parameters
- astropy AsinhStretch: y = asinh(x/a)/asinh(1/a) on data normalized to [0,1]; a is the linear-to-log knee as a fraction of the range, default a=0.1; smaller a is more logarithmic. verified: https://raw.githubusercontent.com/astropy/astropy/main/astropy/visualization/stretch.py (docs are astropy v8.0.2: https://docs.astropy.org/en/stable/visualization/normalization.html)
- Lupton asinh: y = asinh(Q*x/stretch) * frac/asinh(frac*Q), frac=0.1; make_lupton_rgb defaults stretch=5, Q=8, interval ManualInterval vmin=0; `minimum` is deprecated in favour of stretch_object / interval. verified: https://raw.githubusercontent.com/astropy/astropy/main/astropy/visualization/lupton_rgb.py
- Lupton 2004: asinh stretch shows faint objects while preserving bright structure; the RGB scheme gives an object of a given astronomical colour a unique RGB colour (needs 3 different bands). verified: https://arxiv.org/abs/astro-ph/0312483
- Firefly (IRSA) offers asinh with a Q value and zscale or sigma as bounds; its zscale defaults are contrast 25, 600 samples, 120 per line. verified: https://raw.githubusercontent.com/Caltech-IPAC/firefly/dev/src/firefly/js/visualize/RangeValues.js
- DS9 exposes asinh as one of its scale functions and zscale as a limits mode (`-asinh`, `-zscale`). verified: https://ds9.si.edu/doc/ref/command.html . DS9 default scale and minmax mode: unchecked.
- Our plan (asinh, black at -1 sigma): matches the practice of asinh for wide dynamic range. The S/N plane is already in sigma units, so a sigma-anchored black point is defensible and simpler than zscale. Deviation: no tool defaults to a fixed -1 sigma black; the norm is zscale (IRAF/DS9/Firefly/astropy) or a percentile interval. Keep -1 sigma but expose the knee a (astropy default 0.1) or Q (Lupton default 8) as a documented constant.

### A2. zscale vs sigma clipping
- astropy ZScaleInterval: IRAF algorithm, contrast 0.25, n_samples 1000, max_reject 0.5, min_npixels 5. verified: https://raw.githubusercontent.com/astropy/astropy/main/astropy/visualization/interval.py
- zscale fits a line to sorted sampled pixels and is meant for sky-dominated images; on 60-120 px stamps with a bright source and a Uint16-quantized plane it has few sky pixels, so it is unstable per frame (reasoning, unchecked empirically).
- Plan matches the better option for S/N stamps. Keep sigma-based limits; do not run zscale per frame.

### A3. Shared vs per-frame normalization for blinking
- IRSA's Firefly viewer locks colour, stretch and overlays across all loaded FITS images by default, with an unlock toggle. verified: https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html
- DS9 offers per-frame scale plus a lock option (`lock scale`): unchecked.
- Plan matches: one shared stretch for all frames is the right default for time blinking (brightness change is the signal). Offer an "unlock per-frame" toggle as Firefly does.

### A4. Colormaps and colour-blind safety
- Okabe-Ito palette is designed to be unambiguous for colour-blind viewers (vermilion rather than red, bluish green). verified (rationale text): https://jfly.uni-koeln.de/color/ . Hex values (#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 #000000) are from memory: unchecked.
- Perceptual single-hue/greyscale for the intensity plane (grey, viridis/magma) is standard; DS9 default colormap: unchecked. Lupton RGB is a band-colour scheme: our frames are epochs of one band, so Lupton on three epochs would make a time composite whose colour means time, not astronomical colour. Plan deviation to resolve: use Lupton only if three different bands exist; use grey frames plus Okabe-Ito outlines or ticks for time.
- Do not encode time by hue alone; add a text label or marker shape (WCAG 1.4.1 use of colour: unchecked URL https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

### A5. Pixel upscaling
- Nearest-neighbour at integer scale preserves true pixels, as DS9 and Firefly do when zoomed in (DS9 zoom behaviour: unchecked). Implement with `ctx.imageSmoothingEnabled=false` plus CSS `image-rendering: pixelated`, drawing at integer multiples of the device pixel ratio (MDN: unchecked).
- Plan matches. Aladin Lite HiPS tiles are resampled by the sky renderer; that is expected, not a deviation.

### A6. WCS display, readouts, orientation
- Readout convention: RA hh:mm:ss.ss and Dec +dd:mm:ss.s (IAU sexagesimal), decimal degrees as a copyable alternate, frame labelled ICRS: unchecked. Aladin Lite exposes degreesToString and cooFrame ("ICRSd" = ICRS decimal) options. verified: https://cds-astro.github.io/aladin-lite/A.html
- IAU source designations (J HHMMSS.s +DDMMSS): unchecked.
- North up, east left is the sky-map default (Aladin); SPHEREx detector frames are not north-up. Required: draw N/E compass arrows from the WCS CD matrix, or reproject; never assume the stamp is north up (reasoning, unchecked).
- Pixel readout should show pixel x,y, RA/Dec, value in S/N sigma, and frame time.

### A7. HiPS in Aladin Lite v3, SPHEREx availability
- CDS publishes SPHEREx QR2 HiPS: D1 to D6 and a colour HiPS. Fields: frame equatorial, order 7, 512 px tiles, formats png and fits, D1 pixel cut 0 10 sqrt, released 2026-05 to 2026-06; service URLs https://alasky.cds.unistra.fr/SPHEREx/D1 ... /D6 and /SPHEREx/color, mirror alaskybis.cds.unistra.fr. verified via the CDS MocServer: https://alasky.cds.unistra.fr/MocServer/query?ID=*SPHEREx*&fmt=ascii&get=record
- Source is IRSA QR2 (progenitor https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2, DOI 10.26131/IRSA652); IRSA itself uses HiPS for coverage views. verified: same record, plus https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html
- Aladin Lite takes a survey as a URL (`survey: 'https://alasky.cds.unistra.fr/DSS/DSSColor/'`, `cooFrame`, `fov`). verified: https://cds-astro.github.io/aladin-lite/A.html . Passing the SPHEREx URL is the expected use but I did not load a tile: from this host `/SPHEREx/D1/properties` returned a CDS 404 page (CORS header `Access-Control-Allow-Origin: *` was present). Unchecked: tile fetch, and the HiPS ID string form.
- Aladin Lite npm: `aladin-lite`, `import A from 'aladin-lite'`; project advises pinning a fixed version. verified: https://github.com/cds-astro/aladin-lite . npm `latest` tag is 3.9.2-beta (verified, registry.npmjs.org/aladin-lite): pin it deliberately; a browser-only lib needs a client component with `dynamic(..., {ssr:false})`.
- IRSA's colour-stretch control is FITS only, not HiPS. verified (same IRSA page). The HiPS layer cannot share our frame stretch; keep the sky map as context only and say so in the UI.
- Legacy Survey viewer (Lupton-style RGB sky browser) and ESA Sky: I could not retrieve their rendering parameters (viewer page is JS-only; unchecked).

### A8. Photosensitive limits (WCAG 2.3.1)
- Pass if no more than three general flashes (and no more than three red flashes) in any one second, or the flash area is within 0.006 sr in a 10 degree field (a 341 x 256 px rectangle at 1024 x 768 is the approximation). A general flash is a pair of opposing luminance changes of 10% or more of maximum relative luminance, where the darker state is below 0.80. verified: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- A frame swap is one change; a flash needs a pair, so 3 fps alternation is at most 1.5 flashes per second: inside the limit. Our plan matches and is conservative. A 120 px frame upscaled 4x is 480 px wide and exceeds the 341 px area, so the area exemption would not apply; rely on the rate cap.
- Add: start paused, pause/stop control, honour `prefers-reduced-motion` (WCAG 2.2.2 pause/stop/hide for motion over 5 s: unchecked URL https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).

## B. Web stack (late 2026)

### B1. Versions (npm registry, verified 2026-11-15)
- next 16.4.6 (latest; engines node >=20.9.0; dist-tag canary 16.5.0-canary.50). react 19.3.1. vitest 5.1.0. @playwright/test 1.65.1. typescript 7.0.2. @vitejs/plugin-react 6.3.0. aladin-lite 3.9.2-beta. Source: https://registry.npmjs.org/<pkg>/latest . TypeScript 7 compatibility with Next 16: unchecked; if `next build` complains, pin typescript 5.x.
- Next 16 defaults: Turbopack default bundler, React Compiler support stable, `proxy.ts` replaces middleware, Cache Components via PPR and `use cache`. verified: https://nextjs.org/blog/next-16 ; upgrade notes: https://nextjs.org/docs/app/guides/upgrading/version-16
- Setup: `create-next-app` with TypeScript, App Router, ESLint, `src/` dir: https://nextjs.org/docs/app/getting-started/installation

### B2. Testing
- Vitest manual setup: `vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths`, config `vitest.config.mts` with `environment: 'jsdom'`; Vitest does not support async Server Components, so test those with E2E. verified: https://nextjs.org/docs/app/guides/testing/vitest
- Playwright: run against a production build (`npm run build && npm run start`) or use the `webServer` option; three browsers. verified: https://nextjs.org/docs/app/guides/testing/playwright
- For canvas, unit-test the stretch and quantization math as pure functions (no jsdom canvas) and assert pixels in Playwright via `page.evaluate` reading `getImageData`. Add a vitest golden test against astropy output (generated offline) for asinh and Lupton.

### B3. Accessible canvas
- Unchecked, standard practice: native `<button>` controls for play/pause/step with visible focus; canvas gets `role="img"` and an `aria-label` describing frame index and time; an `aria-live="polite"` status for readouts; arrow keys step frames, Space toggles blink, Escape pauses; text alternative table of the readout values. Refs: https://www.w3.org/WAI/ARIA/apg/ , https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- Chart and sky map need their own text alternatives; Aladin Lite keyboard support is unchecked.

### B4. Core Web Vitals
- Good thresholds at the 75th percentile: LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less. verified: https://web.dev/articles/vitals
- Lighthouse performance score of 90 or more is the usual target: unchecked. Reserve canvas and map box sizes with CSS aspect-ratio to hold CLS near 0; lazy-load Aladin Lite (large WASM bundle) with `next/dynamic` (https://nextjs.org/docs/app/guides/lazy-loading , verified) and keep the first frame as the LCP element, not the map.

### B5. Serving Uint16 binaries with immutable caching on Vercel
- Next sets `public, max-age=31536000, immutable` only on content-hashed build assets and that cannot be overridden; for other files set headers yourself in `next.config` `headers()`. verified: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
- Vercel guidance: immutable hashed assets use `max-age=31536000, immutable`; shared pages use `s-maxage`. verified: https://vercel.com/docs/caching/cache-control-headers
- Recommendation: put data in `public/data/` with content-hashed names (e.g. `frames.<sha8>.u16`) and a `headers()` rule `source: '/data/:path*'` with `Cache-Control: public, max-age=31536000, immutable`; ship a small JSON manifest with scale, offset and hash (no-cache or short s-maxage). Vercel's default header for unhashed `public/` files: unchecked. Consider Vercel Blob (https://vercel.com/docs/vercel-blob, verified to exist) only if data exceeds the deploy size limit (limit value unchecked).
- Compression: Uint16 noise-like data compresses poorly; use Brotli on the quantized, delta or byte-shuffled form (unchecked), and decode with `new Uint16Array(await res.arrayBuffer())`; mind endianness (write little-endian explicitly).

### B6. Web Workers in Next.js
- Next's bundler handles `new Worker(new URL('./w.ts', import.meta.url))`; the docs list `new Worker()` among expressions that accept bundler magic comments. verified: https://nextjs.org/docs/app/guides/lazy-loading . Turbopack worker support for this pattern: unchecked, test in `next build`.
- Use a worker for decode plus stretch into an `ImageData` buffer; transfer the ArrayBuffer; optionally `OffscreenCanvas`. Stamps are tiny (120x120x8 frames), so a worker is only worth it if profiling shows main-thread work over 50 ms; INP is the criterion.

### B7. HTTP Range reads from public S3 in the browser
- S3 CORS needs AllowedMethods, AllowedOrigins, AllowedHeaders, ExposeHeaders and MaxAgeSeconds elements. verified: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html
- Unchecked specifics: send `Range: bytes=a-b`; the bucket needs `AllowedHeaders: ["Range"]`, `ExposeHeaders: ["Content-Range","Accept-Ranges","Content-Length","ETag"]`; a Range header can trigger a preflight, so the owner must set CORS. For IRSA's public bucket we do not control CORS: test with `curl -H "Origin: ..." -H "Range: bytes=0-99"`; if it fails, proxy through a Route Handler (it forwards Range and sets immutable caching) or pre-extract the stamps, which is our plan anyway.

## Adopt / change in our plan
1. Keep one shared stretch for all frames as default, add an "unlock per frame" toggle: Firefly/IRSA locks stretch across FITS images by default. https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html
2. Keep asinh with black at -1 sigma but store the knee as a named constant (astropy a=0.1 or Lupton Q=8, stretch=5) and golden-test against astropy output. https://raw.githubusercontent.com/astropy/astropy/main/astropy/visualization/stretch.py
3. Do not use Lupton RGB on epochs of one band; reserve it for true multi-band composites, and mark time with Okabe-Ito plus text/shape. https://arxiv.org/abs/astro-ph/0312483 , https://jfly.uni-koeln.de/color/
4. Blink: default paused, 3 fps max (about 1.5 flashes/s, inside WCAG 2.3.1), pause control, honour prefers-reduced-motion. https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
5. Draw N/E compass arrows from the frame WCS; frames are not north up. Readouts: RA hh:mm:ss.ss, Dec +dd:mm:ss.s, decimal degrees, ICRS label, pixel and S/N value (IAU format unchecked). https://cds-astro.github.io/aladin-lite/A.html
6. Pin Next 16.4.x (Node 20.9 or newer), React 19, vitest 5, Playwright 1.65; verify TypeScript 7 builds or pin 5.x. https://registry.npmjs.org/next/latest , https://nextjs.org/blog/next-16
7. Test layering: vitest (jsdom) for pure math and sync components, Playwright against `next build && next start` for the canvas and async routes. https://nextjs.org/docs/app/guides/testing/vitest , https://nextjs.org/docs/app/guides/testing/playwright
8. Load Aladin Lite via `next/dynamic` ssr:false in a client component, pin an explicit version (npm latest is a beta); use CDS SPHEREx HiPS (D1..D6, color) as context only, since HiPS has no shared stretch. https://github.com/cds-astro/aladin-lite , https://alasky.cds.unistra.fr/MocServer/query?ID=*SPHEREx*&fmt=ascii&get=record
9. Before building the map, fetch one SPHEREx HiPS tile from a browser origin to confirm CORS and URL form (curl got a 404 on /properties). https://alasky.cds.unistra.fr/SPHEREx/D1
10. Serve data as content-hashed `/data/*.u16` with `Cache-Control: public, max-age=31536000, immutable` set in `next.config` headers(); manifest with short cache. https://nextjs.org/docs/app/api-reference/config/next-config-js/headers , https://vercel.com/docs/caching/cache-control-headers
11. Nearest-neighbour: `imageSmoothingEnabled=false` plus `image-rendering: pixelated`, integer scale only (unchecked MDN). Keep P3 with sRGB fallback only if you test pixel values; greyscale needs no wide gamut, so P3 adds little. https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext
12. Accessibility: real buttons, canvas `role="img"` with changing aria-label, aria-live readout, arrow keys step frames, data table fallback (unchecked). https://www.w3.org/WAI/ARIA/apg/
13. CWV budget: LCP 2.5 s, INP 200 ms, CLS 0.1 at p75; reserve boxes with aspect-ratio, lazy-load the map; Lighthouse 90 or more (unchecked). https://web.dev/articles/vitals
14. Worker only after profiling; use `new Worker(new URL(...))` and transfer buffers; confirm it builds under Turbopack. https://nextjs.org/docs/app/guides/lazy-loading
15. Range reads: test CORS on the real bucket (Range allowed, Content-Range exposed); if absent, pre-extract stamps or proxy through a Route Handler. https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html
