# Decisions: changes from the wireframe and why

This file is kept in step with section 14 of `docs/BUILD_PROMPT.md`.


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

