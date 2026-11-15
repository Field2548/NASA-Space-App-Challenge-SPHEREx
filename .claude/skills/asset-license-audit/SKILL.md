---
name: asset-license-audit
description: Check copyright and licenses for everything that ships on the public website (fonts, sounds, music, images, icons, videos, 3D models, datasets, code packages, copied code snippets, NASA/IRSA data and logos) and keep CREDITS.md up to date. Use whenever an asset or dependency is added or changed, when the user asks "can we use this font/sound/image", "check copyright", "check licenses", "credits", "attribution", and always before a production deploy to Vercel or a Space Apps submission.
---

# Asset & license audit

The site is public (Vercel) and is a NASA Space Apps Challenge 2026 entry, so every file a
visitor can download must be legal to redistribute. This skill finds every third-party thing
in the site, checks its license, records it in `CREDITS.md`, and reports what blocks a deploy.

This is a first-pass check, not legal advice. When a license is unclear, say so and treat it
as **not allowed** until a human confirms.

## 1. Inventory: find every third-party item

Look in the web app's folder (e.g. `web/`, `public/`, `src/`, `app/`, `assets/`) and the repo root:

| Kind | Where to look |
| --- | --- |
| Fonts | `*.woff* *.ttf *.otf`, `@font-face`, `fonts.googleapis.com`, `next/font/*`, `@fontsource/*` |
| Audio | `*.mp3 *.wav *.ogg *.m4a *.flac`, `new Audio(`, `<audio>`, Howler/Tone.js sample URLs |
| Images / icons / video | `*.png *.jpg *.jpeg *.gif *.webp *.svg *.ico *.mp4 *.webm`, icon packages, CSS `url(...)` |
| 3D / textures | `*.glb *.gltf *.obj *.fbx *.hdr *.exr` |
| Remote assets | any `http(s)://` URL in code or CSS that loads media, fonts, or scripts (hotlinking counts) |
| Data | SPHEREx/IRSA images, JPL Horizons positions, catalogues, CSV/JSON in `public/` |
| JS packages | `package.json` + lockfile (production dependencies ship in the bundle) |
| Python packages | `requirements.txt` (matters if a Python backend/function ships) |
| Copied code | snippets from Stack Overflow, blogs, CodePen, GitHub gists; look for comments naming a source |
| AI-generated media | images/sounds made with a generator; record which tool and check its terms |

Our own generated outputs (e.g. `data/motion_*/summary.png`) are ours, but they are derived from
SPHEREx data, so they need the data credit in section 3.

## 2. Check each item's license

Find the license at the **original source** (the font foundry, the sound page, the repo's
LICENSE file), not a re-upload site. Record the source URL.

**Allowed (with the stated duty):**
- Fonts: SIL Open Font License (OFL, e.g. all Google Fonts), Apache-2.0, Ubuntu Font Licence. Keep
  the license file next to self-hosted font files (`OFL.txt`). Do not sell the font file alone.
- Sounds/images: CC0 / public domain (no duty, credit anyway), CC BY (credit author + license + link),
  Pixabay/Unsplash/Pexels content licenses (check the current terms; no redistribution as standalone files).
- Code: MIT, BSD, ISC, Apache-2.0 (Apache: keep NOTICE), MPL-2.0 (keep file-level notices), Zlib.
- Our own work, and work from teammates who agreed to it.

**Needs a human decision (flag, do not ship by default):**
- CC BY-SA (our derivative must use the same license), CC BY-NC (non-commercial only; a hackathon
  site is probably fine but the team must decide), LGPL, GPL, AGPL (AGPL triggers for hosted sites).
- Licenses that changed recently, dual licenses, AI-generated media whose tool terms are unclear.

**Not allowed:**
- No license stated, "found on Google Images", YouTube rips, game/film/TV sounds or music,
  commercial songs, "free for personal use" fonts (a public site is not personal use),
  CC BY-ND if we modified it, SSPL/BUSL/Commons Clause/Elastic code, fonts copied from an OS
  (e.g. Windows `C:\Windows\Fonts`, macOS system fonts).
- Recreating a recognisable game, film or brand's art, characters, or sounds, even if "inspired by".

## 3. NASA, IRSA and Space Apps rules (project-specific)

- **NASA data and imagery** are generally not copyrighted, but credit them. For SPHEREx data from
  IRSA, use the acknowledgment text IRSA publishes on its SPHEREx and "Acknowledging IRSA" pages
  (fetch the current wording; do not invent it). The standard IRSA line is:
  "This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the
  National Aeronautics and Space Administration and operated by the California Institute of Technology."
- **JPL Horizons** positions: credit "JPL Horizons, NASA/JPL Solar System Dynamics".
- **NASA insignia are restricted**: the "meatball" logo, the "worm" logotype and the NASA seal
  may not be used without NASA permission (14 CFR Part 1221). Do not put them on the site, in the
  favicon, or in generated art, and do not imply NASA endorses the project.
- **Space Apps branding**: use only what the current Space Apps brand/resource guidelines allow,
  and follow the challenge's rules on resources and AI-use disclosure. Fetch the current rules
  before the final submission rather than relying on memory.
- **Images not by NASA**: some images on NASA sites are by third parties (ESA, universities,
  photographers) and *are* copyrighted. Check the credit line of each image.
- Scientific software (astropy, astroquery, photutils) asks for citations. That is not a legal
  duty, but list them in CREDITS.md.

## 4. Run the dependency scanners

```bash
# JS (from the web app folder, after npm install): production deps only
npx --yes license-checker-rseidelsohn --production --summary
npx --yes license-checker-rseidelsohn --production --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;0BSD;CC0-1.0;MPL-2.0;Unlicense;BlueOak-1.0.0;Python-2.0;CC-BY-4.0"

# Python (inside the venv)
.venv/Scripts/python.exe -m pip install pip-licenses
.venv/Scripts/python.exe -m piplicenses --from=mixed --format=markdown
```

`--onlyAllow` fails on anything outside the list; review each failure by hand (it may be a
mislabelled permissive license, or a real problem). "UNKNOWN" means a human must look.

## 5. Keep CREDITS.md current

Create or update `CREDITS.md` at the repo root (and link it from the site footer, e.g. a
"Credits" page). One row per asset; group by kind:

```markdown
| Asset | Used in | Author / source | License | Duty | Checked |
| --- | --- | --- | --- | --- | --- |
| Inter (font) | site UI | Rasmus Andersson, https://rsms.me/inter/ | OFL-1.1 | keep OFL.txt | 2026-11-15 |
| click.ogg | button sound | "user123", https://freesound.org/s/12345/ | CC0 | none | 2026-11-15 |
| SPHEREx images | all motion figures | NASA/IPAC IRSA | public data | IRSA acknowledgment | 2026-11-15 |
```

CC BY items must show **title, author, source link, license link**, and say if we changed it
(e.g. "trimmed and pitched down").

## 6. Report

Output, in this order:
1. **Blockers** (not allowed, or unknown): file path, why, what to do (replace with X, ask author, remove).
2. **Needs a team decision**: file, license, what it would oblige us to do.
3. **OK**: count per kind, and confirm each has a CREDITS.md row and required license files.
4. What was **not** checked (e.g. remote URLs that could not be fetched).

Before a production deploy, there must be zero blockers and the credits page must be live.
