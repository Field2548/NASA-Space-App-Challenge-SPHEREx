# PLAN 2 - GAME agent (scaffold, design, viewer, tools, tutorial)

Branch: `web-game`. Read first: `docs/plans/00-COORDINATION.md`, then `docs/BUILD_PROMPT.md` (BP) sections 3, 5, 8.1, 8.3 to 8.10, 8.13, 8.15, 9, 11, 12, 13, 16.
Skills to use: `frontend-design` (first), `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines` (review at end), `webapp-testing`.

Your job in one line: create the web app from nothing and build everything a player touches in a round: viewer, tools, timeline, tutorial. You also open the team board and publish the type contract.

## Who you depend on, who depends on you

| You need | From | You give | To |
| --- | --- | --- | --- |
| fixture spot, field schema (40 min) | DATA | scaffold, `types.ts`, `layout.tsx`, tokens | everyone |
| `/api/check` stub and API contract | SERVER | `FieldViewer` click events, `Track`, marks | SERVER (Inspect, check) |
| real spots, `exposures.u16` | DATA | viewer slots for Inspect, overlays, wavelength switch | DATA, SERVER |

## Phase 0 (03:30 - 04:00): do these first, everyone is waiting

- [x] `web` is on origin; TEAM BOARD is issue #2 (pinned, poll routine in its body); all labels exist; `scripts/poll.sh` is on `web`.
- [ ] `git fetch origin && git checkout -b web-game origin/web`. Post `[GAME] I am @toonzzzrock` on the board, start the 15-minute poll loop (coordination 3.4).
- [ ] `web/`: Next.js latest stable, App Router, TypeScript, vitest, Playwright. Pin versions. `next/font/google` for Orbitron and JetBrains Mono. Tokens and P3 overrides in `globals.css` (BP 12). Blueprint grid background. ASCII logo placeholder constant `{{PROJECT_NAME}}` ("ONION//SKY") in one file.
- [ ] `web/lib/types.ts` + `docs/contracts/types.md` (BP section 9 types). PR into `web`, merge fast (this one needs no review), and announce on the board.
- [ ] Empty routes: `/`, `/tutorial`, `/play`, `/embed`, `/about`, `/credits`. First Vercel **preview** deploy (HUMAN links project; until then local only, say so on the board).
- [ ] `docs/credits/game.csv`: Next.js, React, Orbitron, JetBrains Mono, lucide-react, vitest, Playwright.

## Adopted from research (docs/research/*.md)

- Blink starts paused, max 3 fps, play/pause plus numbered frame buttons; per-frame strip always visible so one-frame artifacts are obvious.
- Marking allows "not visible in this frame"; marks must fit straight-line motion before Submit is enabled.
- Tutorial includes a false-positive gallery: cosmic ray (one frame only), static star (same place every frame), bad frame (flag, do not report).
- Field guide one click away at all times; tutorial levels replayable.
- Asinh knee stored as one named constant and tested against astropy `AsinhStretch` output.
- Canvas: `role="img"` with a live `aria-label`, an `aria-live` readout, arrow keys step frames.

## Phase 1 (04:00 - 08:00): MVP safety-net demo

- [ ] `lib/coords.ts` (`parseCoordinates`, `formatRA`, `formatDec`) with vitest for every format in BP 8.3 and bad input.
- [ ] `lib/wcs.ts` (`pixelToSky`, `skyToPixel`), `lib/fields.ts` (`loadFieldIndex`, `loadField`, `loadThumbs` first, `loadFrames` u16 to S/N floats, `prefetchField`).
- [ ] `lib/imaging.ts`: `makeSharedStretch`, `colorByTime`, `paperMode`, `onlyChanges`, `toImageData`. One shared stretch; overlay stretch black point at +1 sigma (BP 8.4).
- [ ] `components/FieldViewer.tsx`: canvas, `imageSmoothingEnabled = false`, integer upscale, hover readout, click to mark, mode shown in cursor and status line, frame info strip, "preview quality" badge for `png8`. Leave named slots for Inspect and overlays.
- [ ] `lib/marks.ts` (`fitTrack`, `isStatic`, `rateArcsecPerHour`), marking in at least 2 frames, "That one didn't move; it's a star."
- [ ] Blink playback capped at 3 frames per second; no autoplay under `prefers-reduced-motion`.
- [ ] `components/BrightnessSlider.tsx` (log scale, landmarks Eros, Hektor, Makemake, Eris, Reset).
- [ ] `components/Timeline.tsx` v1: Track 1 frames with thumbnails and time-colored borders, playhead, step with arrow keys.
- [ ] Submit button calls SERVER's `/api/check` (stub reads answer JSON). "Nothing moved here" button.
- [ ] Guest mode in localStorage; the app works with no Supabase env vars.
- [ ] Layout (BP 8.1) at 1440x900: top bar, left panel with slots, center viewport, right panel slot for the scoreboard, bottom timeline.
- [ ] Tutorial levels 0 and 1 with `CoachMark`, auto-detected step completion, saved progress, keyboard-only path. Plain words, one idea per step. Level 1 has slots for the Inspect reveal and the overlay step (SERVER and DATA fill them in phase 3).
- [ ] Title screen `/`: ASCII starfield, "Start training", "Skip to game", "Log in".
- [ ] Preview deploy, post URL on the board.

## Phase 2 (08:00 - 12:00): tools and levels

- [ ] `lib/palettes.ts`: `timeColors(n, vision)` (Okabe-Ito for normal, protan, deutan; own tritan palette; scale-to-white kept), `simulateCvd` (Machado 2009). Test: CIEDE2000 at least 10 for all pairs n up to 7 under each vision type. `VisionPicker.tsx`: one choice, five options.
- [ ] Image tools (BP 8.5): Color by time, Paper mode, Show only changes, Remove star glow (white top-hat about 2.5 px), Make dots bigger (dilation 1 px). At most two active. Tooltip plus 3-sentence explainer each. `ToolsPanel.tsx`.
- [ ] `lib/framePicker.ts` (`pickFrames`, even and growing, snapping to real bursts, no repeats) and `FramePicker.tsx` with the one-line "closest real moments" notice. Works over the 5 exported frames until pools exist.
- [ ] Timeline v2: onion range handles, Track 2 "My marks", Track 3 "Answers" after check, real-time-spacing toggle (log scale for Growing).
- [ ] URL state (`/play?ra=&dec=&fov=&spot=&frames=&spacing=&vision=`) and `/embed`. Coordinate parsing hooks into SERVER's coordinate box component; agree on props in a `contract` issue.
- [ ] Mount DATA's `WavelengthSwitch` in the left panel; call its hook from the viewer.
- [ ] Tutorial levels 2 to 5 (BP 8.13 table), unlocking tools one by one. Level 5 reports Eris margin honestly (6.9 sigma vs 5.9 bar).
- [ ] `/about` copy (how it works, data sources, how AI was used) and `/credits` rendering `CREDITS.md`.
- [ ] Credits rows for anything new.

## Phase 3 (12:00 - 16:00): wiring

- [ ] Inspect toggle (button + `I` key); when on, clicks go to SERVER's `InspectPopup`, else mark. Mode always visible.
- [ ] Overlay toggles UI (`OverlayToggles.tsx`); data from DATA's `lib/overlays.ts`. Tutorial level 1 overlay step and level 4 star-ring step.
- [ ] Tutorial level 1 reward: auto-open Inspect on the found object after Submit; level 4 locked/unlocked behaviour.
- [ ] Scoreboard slot, auth dialog slot, density toggles slot ("Show my work", "Show others' work") wired to SERVER's components.
- [ ] Follow and stack tool (`followAndStack`) and distance hint: cut-list items, build only if on schedule.

## Phase 4 (16:00 - 19:00): polish

- [ ] Design pass against BP section 12: neutral black science viewport (no glow or overlap on the image), scanline toggle, reduced-motion respected, hazard stripes only on experimental features.
- [ ] Mobile basics (bottom sheets) only if time. P3 canvas try/catch.
- [ ] `web-design-guidelines` review: keyboard focus, labels, contrast at least 4.5:1. Lighthouse desktop: performance at least 80, accessibility at least 90.
- [ ] Performance: first-load JS small (check `next build`), lazy-load Aladin, idle prefetch of next level and 3 nearest spots.

## Phase 5 (19:00 - 21:00)

- [ ] Playwright (`webapp-testing`): tutorial levels 0 and 1 finish by clicking answer-key positions; guest mode works with no Supabase env; `/play?ra=&dec=` restores view; keyboard-only playthrough of level 1; no console errors.
- [ ] Science check: your Color by time for Eros vs `data/motion_*/onion_dark.png`, downsampled, correlation at least 0.9.
- [ ] Update `CLAUDE.md` with a short web section (SERVER may help). Post final status.

## Your unit tests

coordinate parser | `pickFrames` | `colorByTime` still star is white | `onlyChanges` still star about 0 | palette color-blind test | `fitTrack` / `isStatic`.

## Done when

Title screen leads through tutorial levels 0 to 5, free play works as a guest, all image tools, vision modes, brightness, timeline and frames-and-spacing work on 5 spots, tests green, Lighthouse targets met, status posted.
