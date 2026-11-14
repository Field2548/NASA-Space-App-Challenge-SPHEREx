# PLAN H - Reserved for the human teammate

Agents cannot do these. They are all asked once, in issue #3, each with the default agents apply while you sleep. Answer there when you wake (tick boxes, comment `[HUMAN] item N: ...`); TEAM BOARD #2 is for status.

## Before 04:30

- [ ] Put the wireframe PDF at `docs/wireframe.pdf` (reference only, never shipped).
- [ ] On the Windows laptop with cached FITS files: `git fetch && git checkout web`, then run the `export_web.py` commands DATA posts, and push `web/public/fields/**` and `web/data/**` to branch `web-data` (or hand the folder to DATA).
- [ ] Start the five `spectral_bands.py` runs from `docs/BUILD_PROMPT.md` section 6.5 (about 15 minutes each, needs network). Use `--out` so committed Cygnus figures are not overwritten.

## Before 10:00

- [ ] Create a free **Supabase** project. Put URL, anon key, service-role key in `web/.env.local` (never commit) and in Vercel environment variables. Tell SERVER on the board that it is ready (do not paste keys in GitHub).
- [ ] `vercel login`, then `vercel link` (or connect the GitHub repo in the Vercel dashboard). Set project root to `web/`.
- [ ] Pick the project name (placeholder is "ONION//SKY", constant `{{PROJECT_NAME}}`).
- [ ] Approve or reject loading the SPIFF `.joblib` (a Python pickle that runs code on load). If approved, DATA does it in a throwaway venv. Download Mamajek's table if DATA cannot fetch it. Mamajek asks users to email him; send it if you want.

## Approvals (answer in issue #3)

- [ ] First production deploy.
- [ ] Any push to `main` (agents never do this on their own).
- [ ] Any deletion, and any change to a Python function signature.

## Final hour (19:00 - 22:00)

- [ ] Play the live URL as a guest, then with a new account, on your own device.
- [ ] Check the "How we used AI" statement and credits page.
- [ ] Submit on the Space Apps site by 22:00 Bangkok. Include `docs/DEMO.md` material (30-second video or at most 7 slides, English subtitles, per the 2026 guide).
- [ ] Confirm GPL-3.0 `LICENSE` is accepted by the team.
