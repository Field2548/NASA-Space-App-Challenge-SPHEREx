#!/usr/bin/env bash
# Rebuild the gitignored inputs the exporter needs (frames.fits + cutouts for the five ready
# spots, then the five 102-band cubes). Needs network access to irsa.ipac.caltech.edu and a
# venv at .venv with requirements.txt installed. Safe to re-run: everything is cached.
#
#   pipeline/dev/rebuild_inputs.sh frames    # about 5 minutes
#   pipeline/dev/rebuild_inputs.sh bands     # several minutes per spot
#
# Frames are rebuilt in work/<slug>/ (not in data/, so the committed PNG results are not
# rewritten), then frames.fits is copied and images/ linked next to the committed results,
# but only if the rebuilt frames.csv lists the same frames as the committed one.
set -u
cd "$(dirname "$0")/../.."
PY=.venv/bin/python
declare -A FOLDER=( [eros]=data/motion_13.2004_14.38_2025-07-09 [eris]=data/motion_26.3271_-0.4338_2026-01-06 [makemake]=data/motion_200.0075_21.523_2025-05-30 [hektor]=data/motion_184.3049_-6.3773_2025-12-24 [cygnus]=data/motion_304.6935_42.4437 [barnard]=data/motion_269.4464_4.7686_2025-08-21 [eps-indi-b]=data/motion_331.0964_-56.8006_2025-04-27 [wise0855]=data/motion_133.7600_-7.2422_2025-05-06 [rw-aur]=data/motion_76.9566_30.4013_2025-09-02 [r-dra]=data/motion_248.1672_66.7550_2025-05-16 )

frames() { slug=$1; shift
  mkdir -p work/$slug; cp -n "${FOLDER[$slug]}/sia_results.ecsv" work/$slug/ 2>/dev/null
  for try in 1 2 3; do
    $PY motion_frames.py "$@" --out work/$slug > work/$slug.log 2>&1 && break
    echo "$slug try $try failed"; sleep 20
  done
  [ -f work/$slug/frames.fits ] || { echo "$slug FAILED"; return; }
  if diff -q <(tr -d '\r' < work/$slug/frames.csv | cut -d, -f1-4) <(tr -d '\r' < ${FOLDER[$slug]}/frames.csv | cut -d, -f1-4) >/dev/null; then
    cp work/$slug/frames.fits ${FOLDER[$slug]}/frames.fits
    [ -e ${FOLDER[$slug]}/images ] || ln -s "$PWD/work/$slug/images" ${FOLDER[$slug]}/images
    echo "$slug OK"
  else echo "$slug: frames.csv DIFFERS from the committed one, not synced"; fi; }

bands() { slug=$1; shift
  for try in 1 2 3; do
    $PY spectral_bands.py "$@" --out data/bands_$slug > work/bands_$slug.log 2>&1 && { echo "$slug OK"; return; }
    echo "$slug try $try failed"; sleep 30
  done; echo "$slug FAILED"; }

mkdir -p work
case "${1:-}" in
  frames)
    frames eros     13.2004 14.3800 --start 2025-07-09T17:00
    frames eris     26.3271 -0.4338 --start 2026-01-06T00:47 --min-spacing 20 --fov 0.1
    frames makemake 200.0075 21.5230 --start 2025-05-30T22:50 --min-spacing 10 --fov 0.1
    frames hektor   184.3049 -6.3773 --start 2025-12-24T10:10
    frames cygnus   304.6935 42.4437 ;;
  stars)   # tool-test stars; the committed sia_results.ecsv holds only the chosen bursts
    frames barnard    269.4464 4.7686   --start 2025-08-21T15:14 --frames 5 --min-images 1 --fov 0.2
    frames eps-indi-b 331.0964 -56.8006 --start 2025-04-27T16:48 --frames 5 --min-images 1 --fov 0.2
    frames wise0855   133.7600 -7.2422  --start 2025-05-06T10:35 --frames 5 --min-images 1 --fov 0.1
    frames rw-aur     76.9566 30.4013   --start 2025-09-02T23:21 --frames 6 --min-images 1 --fov 0.1
    frames r-dra      248.1672 66.7550  --start 2025-05-16T22:50 --frames 6 --min-images 1 --fov 0.1 ;;
  bands)
    bands eros     13.2004 14.38    --size 0.3 --fov 0.2
    bands eris     26.3271 -0.4338
    bands makemake 200.0075 21.523
    bands hektor   184.3049 -6.3773 --size 0.3 --fov 0.2
    bands cygnus   304.6935 42.4437 --size 0.3 --fov 0.2 ;;
  *) echo "usage: $0 frames|bands|stars"; exit 2 ;;
esac
