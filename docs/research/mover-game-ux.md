# Mover-hunting citizen science: design survey for the SPHEREx blink game

Scope: how existing projects show frames, collect marks, train non-specialists, give feedback, teach artifacts, and score. Every claim has a URL. "Unchecked" = not verified from a primary page. Not found anywhere: any published blink rate (frames per second) for any project below; treat the rate as a thing we must test ourselves.

## Backyard Worlds: Planet 9 (BYW, Zooniverse)
- Frames: 4 difference-image epochs from time-resolved WISE coadds, shown as an animated "flipbook" with a play button and 4 radio buttons to step frames. Source: https://ar5iv.arxiv.org/html/1705.02919
- Image processing: difference images clipped to -0.5 to 9.5 sigma, a 12x12 tophat-smoothed copy subtracted, arcsinh stretch, false color (W1 blue, W2 red, mean green). Same source.
- Marking: hover turns the cursor into a marker; a click leaves a green crosshair; coordinates are saved on "Done". The task is to mark the candidate "in all four images". Same source.
- Two target classes taught: "movers" (fast, move more than a FWHM over the baseline) and "dipoles" (slow, a +/- pair). Same source.
- Tutorial and Field Guide show movers, dipoles and the common artifacts (partially subtracted variable stars and galaxies, cosmic rays, ghosts, latents). Same source. A moderator guide adds: a true fast mover appears in all four frames; a "ghost" appears in only two frames and is not reported; apparent multiple dipoles that "elongate" are "petals" from misalignment; stripes, black or half-cut frames get the #badimage tag. https://blog.backyardworlds.org/2017/06/28/a-guide-to-classifying-objects-on-backyard-worlds-planet-9-from-the-point-of-view-of-a-citizen-scientist/
- Escalation path: Talk forum for asking others, plus a "Think You've Got One" web form to the science team. The first brown dwarf was the 117th form submission, confirmed by one candidate noticed on Talk and reported by a second user; 3 more users had also classified that flipbook. https://ar5iv.arxiv.org/html/1705.02919
- Feedback: no per-classification right/wrong feedback described in the paper or guide; feedback is social (Talk) and the discovery papers. (Unchecked beyond those pages.)
- Consensus: the paper describes marks plus the form; I found no published aggregation algorithm. Later papers say candidates were also found by volunteers using their own tools (e.g. https://arxiv.org/abs/2604.01323, unchecked beyond one passage).
- Scale: ~76,000 participants in the first months (unique IPs), first report 6 days after launch. https://ar5iv.arxiv.org/html/1705.02919
- Accessibility: Zooniverse default only; false color W1/W2 has no stated colorblind mode (unchecked).
- Lesson: false-color-by-band plus differencing was enough for non-specialists, but the project relies on human escalation (Talk, form) rather than automatic scoring.

## Asteroid Zoo (Zooniverse + Planetary Resources, Catalina Sky Survey data)
- Frames: each image set is 4 exposures 6-7 minutes apart, animated so real objects "move" (per search summary of University of Arizona and Zooniverse pages; page text itself unchecked). https://lpl.arizona.edu/news/spotlight/catalina-sky-survey-wants-your-help-hunting-asteroids
- Marking: click the object in each of the 4 frames, "not visible" allowed on some frames, then Done; for several objects finish one track, press Done, start the next (volunteer-reported workflow, not official docs). https://talk.asteroidzoo.org/boards/BAZ0000003/discussions/DAZ00005fc
- Overlap between fields is built in so a mover leaving one set appears in another (scientist comment on Talk, same source family).
- Status: public data exhausted in 2016, project ended. https://en.wikipedia.org/wiki/Asteroid_Zoo
- Unchecked: blink speed, tutorial content, aggregation, recall.
- Related: Catalina Outer Solar System Survey (Zooniverse) uses images from different months because TNO motion is invisible within minutes; same lesson as SPHEREx's long baseline. https://www.zooniverse.org/projects/fulsdavid/catalina-outer-solar-system-survey/about/research

## Comet Hunters (Zooniverse, Subaru HSC data)
- Data: Subaru Hyper Suprime-Cam; a new interface for main-belt searching was added in June 2016. https://daily.zooniverse.org/2016/06/06/fresh-images-on-comet-hunters/
- Project is finished ("out of data"). https://www.zooniverse.org/projects/mschwamb/comet-hunters
- Unchecked: marking mechanics, tutorial, aggregation. The Research page was empty when fetched (https://www.zooniverse.org/projects/mschwamb/comet-hunters/about/research).

## Active Asteroids and Rubin Comet Catchers (Zooniverse)
- Task: one question per DECam cutout, "is there a tail or coma on the object at the green reticle?", with a 0-9 style activity scale for the team's labels. https://arxiv.org/abs/2403.09768 (text read from the cached full paper)
- Tutorial shown on first visit with tips for look-alikes (background galaxies); can be reopened any time; a Field Guide covers cosmic rays. Same paper.
- Training subjects ("gold standard", activity-confirmed, never retired) are shown with probability 50% for classifications 1-10, 20% for 11-50, 10% for 51-100, 5% afterwards, with immediate correct/incorrect feedback. Same paper.
- Consensus: each sample image is retired after 15 classifications; per-user and per-image metrics are tested against a vetted "control list" of strong candidates and a threshold (initially 40%) is lowered until every control item is recovered. Same paper. Scale: 430,000+ images, ~6.7 million classifications.
- Accessibility: Zooniverse standard; none beyond that stated.
- Rubin Comet Catchers builds on it: flipbook-style sequences of 2-20 images per moving object so tails are distinguishable from galaxies and artifacts; objects flagged by multiple volunteers go to scientists. Some training images are DECam, the rest Rubin. https://www.zooniverse.org/projects/orionnau/rubin-comet-catchers/about/research
- Rubin provides notebooks to push data to Zooniverse and a project review process. https://citizen-science.lsst.io/citizen-science-project-guide/overview/index.html

## Kilonova Seekers (GOTO) and Supernova Hunters (Pan-STARRS)
- Frames: not a blink. Static panels: science, reference, difference image with a crosshair at the candidate. Gen 2 added 32x32 px sub-frame panels showing the individual exposures, because volunteers "overwhelmingly" labeled cosmic rays as real despite Field Guide text; a cosmic ray is visible in one sub-frame only. https://arxiv.org/abs/2406.02334
- Task: "is there a real source at the crosshair?"; yes/no/unsure; mobile swipe-left/right workflow; ~a third of classifications from phones, and users are bimodal (all-phone or no-phone). Same paper.
- Consensus: retired at 15 votes; alert rules fire on real-time vote consensus. Class balance by histogram-equalized sampling in real-bogus score bins. Same paper.
- Volunteer performance: 600,000 classifications, ~2,000 volunteers, 20 discoveries, 17,682-detection gold-standard set; per-volunteer median F1 78% (with large spread); 128 skilled, 41 underconfident (high precision, low recall), 0 overconfident, 2 unskilled among those with over 100 classifications. Same paper.
- Training: Field Guide plus Talk; the change that fixed a recurring error was a new view, not more text. Same paper.
- Supernova Hunters: three panels (target, reference, difference), questions leading to real/bogus; FAQ teaches the pattern "a real supernova looks like a star in the rightmost image, visible in the leftmost, not in the centre". https://www.zooniverse.org/projects/dwright04/supernova-hunters/about/faq
- Performance: volunteers give a very pure high-confidence sample but miss less obvious candidates vs expert labels; a simple human+CNN score combination beat either alone at any purity/completeness. https://ar5iv.arxiv.org/html/1707.05223
- Citizen ASAS-SN (variable-star classification): tutorial plus field guide, "gold-standard" candidates shown to new users with feedback to train them, "unknown" and "junk" options; beta testers (58) asked for a shorter tutorial and more field-guide examples. Accuracy lower for rotational variables. https://arxiv.org/abs/2103.02005

## IASC (International Astronomical Search Collaboration) with Astrometrica
- Format: month-long campaigns; teams search provided image sets with Astrometrica (Windows) and report to the Minor Planet Center; students on a team are told to know "true and false signatures (not all moving things are asteroids)" and to prepare a clean MPC report. https://iasc.cosmosearch.org/
- Materials: installer, Quick Start Guide, and Practice Image Sets for rehearsal before campaigns; Astrometrica page shows a blink GIF of a moving object. https://iasc.cosmosearch.org/Home/Astrometrica
- Corrections: reports can be fixed by emailing staff with the image set name and team name; this is manual, not live feedback. https://iasc.cosmosearch.org/Home/FAQ
- Unchecked: blink rate, number of frames per set, scoring and how provisional discoveries are verified.
- Lesson: the practice-set-before-campaign pattern plus a real external verdict (provisional designation) is the strongest motivator, but it is desktop-only and expert-tool heavy.

## Rubin education tools
- Rubin lists citizen science projects (Comet Catchers, Alert Explorers, Galaxy Zoo: Rubin) and mentions activities and a Space Surveyors game; contents of the game not checked. https://rubinobservatory.org/explore/citizen-science
- No Rubin-specific blink education tool with injected movers found.

## Papers on volunteer performance and gold standards (reading list)
- Kilonova Seekers per-volunteer precision/recall and gold-standard set: https://arxiv.org/abs/2406.02334
- Active Asteroids training-image schedule, control list: https://arxiv.org/abs/2403.09768
- Supernova Hunters human+machine combination: https://arxiv.org/abs/1707.05223
- Space Warps I (simulated lenses injected as training, SWAP weighting): https://arxiv.org/abs/1504.06148 (title only checked; injected-sim detail unchecked here)
- Zooniverse best practices (2015 workshop): https://help.zooniverse.org/best-practices/
- I found no published recall measurement for BYW movers using injected synthetic movers (unchecked; not seen in searched sources).

## Adopt for our game (ranked)
1. Seed known-answer training subjects with immediate right/wrong feedback, shown often early and decaying with experience (50%, 20%, 10%, 5% by item counts). Source: Active Asteroids, https://arxiv.org/abs/2403.09768
2. Inject synthetic movers (we control position, speed, flux) as hidden gold subjects to measure per-player and per-field recall and calibrate the bot-match verdict. Source: Space Warps simulated lenses, https://arxiv.org/abs/1504.06148 (detail unchecked) and gold sets in https://arxiv.org/abs/2406.02334
3. Mark in 2+ frames, as BYW marks all 4, with "not visible in this frame" allowed and a Done button; require marks to be consistent with linear motion before the verdict. Source: https://ar5iv.arxiv.org/html/1705.02919 and Asteroid Zoo Talk https://talk.asteroidzoo.org/boards/BAZ0000003/discussions/DAZ00005fc
4. Show a per-frame thumbnail strip beside the blink so single-frame artifacts (cosmic rays, ghosts) are visible as appearing in only one frame; the Gen 2 sub-frame panel fixed a persistent error text could not. Source: https://arxiv.org/abs/2406.02334
5. Teach false positives as a named gallery, each with the rule that identifies it: ghost = 2 frames only, petals = alignment, stripes/bad frame = flag not report, static star = fixed in every frame. Source: https://blog.backyardworlds.org/2017/06/28/a-guide-to-classifying-objects-on-backyard-worlds-planet-9-from-the-point-of-view-of-a-citizen-scientist/
6. Include "nothing moved" control fields at a fixed share and score a correct "nothing" as a win, so players learn restraint; the pure-sample/missed-faint pattern shows humans under-report faint candidates and over-trust artifacts. Source: https://ar5iv.arxiv.org/html/1707.05223 and https://arxiv.org/abs/2406.02334
7. Offer a frame-step control and playback speed slider with play/pause plus numbered frame buttons (BYW has play plus 4 radio buttons); pick the default rate by our own pilot, since no project publishes one. Source: https://ar5iv.arxiv.org/html/1705.02919
8. Let the Field Guide stay one click away and reopenable at any time, with tutorial levels re-playable. Source: Active Asteroids, https://arxiv.org/abs/2403.09768
9. Combine human marks with the bot candidates in the verdict (agreement with bot raises confidence; humans-only finds go to "unconfirmed"), instead of only scoring against the bot. Source: https://ar5iv.arxiv.org/html/1707.05223
10. Track per-player precision and recall on the hidden gold items and use it to weight verdicts and unlock levels (skilled vs underconfident split is visible). Source: https://arxiv.org/abs/2406.02334
11. Provide a practice set before the real session and a real external verdict (known-object match, like MPC designation) as the payoff. Source: IASC, https://iasc.cosmosearch.org/Home/Astrometrica
12. Keep the interface touch-first with a one-handed mark/skip; about a third of Kilonova Seekers classifications are on phones, bimodal per user. Source: https://arxiv.org/abs/2406.02334
13. Include an "unsure" option and a "bad image" flag; unsure answers help uncertainty estimation, and bad frames are not reported. Source: https://arxiv.org/abs/2406.02334 and https://arxiv.org/abs/2103.02005
14. Keep sequences short (2-8 frames; Rubin Comet Catchers uses 2-20) so a task takes seconds. Source: https://www.zooniverse.org/projects/orionnau/rubin-comet-catchers/about/research
15. Pilot the tutorial with a small beta group and shorten it from their feedback (ASAS-SN did this). Source: https://arxiv.org/abs/2103.02005
