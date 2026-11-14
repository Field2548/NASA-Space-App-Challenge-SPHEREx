"""Turn a spectral_bands.py cube into the web app's spectrum tiles.

File format: docs/contracts/field-schema.md section 8 (the contract; keep both in step).
Input is a data/bands_<slug>/ folder (cube.fits + bands.csv). Output is
out_dir/spectrum/index.json and out_dir/spectrum/t_<tx>_<ty>.u16.

Needs numpy and astropy only. Quantizing reuses export_web.quantize_plane, so the cube
follows the same rule as the single exposures.
"""
import csv
import json
import os
import shutil
import warnings

import numpy as np

NODATA = 65535
GRID_TOLERANCE_DEG = 1e-6        # about 0.004 pixel; the grids are built the same way, so exact


def cube_grid(cube_path):
    """(width, height, crval, crpix) of a cube.fits grid, read from its FITS header."""
    from astropy.io import fits
    hdr = fits.getheader(cube_path)
    return (int(hdr["NAXIS1"]), int(hdr["NAXIS2"]),
            (float(hdr["CRVAL1"]), float(hdr["CRVAL2"])), (float(hdr["CRPIX1"]), float(hdr["CRPIX2"])))


def check_cube_grid(bands_folder, size, crval, crpix, tol=GRID_TOLERANCE_DEG):
    """Raise ValueError unless the cube is on the spot's pixel grid: same size, same sky
    centre (within tol degrees) and same reference pixel. Without this a cube from the wrong
    field fov would silently show spectra of the wrong pixels."""
    w, h, cube_crval, cube_crpix = cube_grid(os.path.join(bands_folder, "cube.fits"))
    problems = []
    if [w, h] != [int(size[0]), int(size[1])]:
        problems.append(f"size {w}x{h} but the spot is {size[0]}x{size[1]}")
    if max(abs(a - b) for a, b in zip(cube_crval, crval)) > tol:
        problems.append(f"sky centre {cube_crval} but the spot is centred on {tuple(crval)}")
    if max(abs(a - b) for a, b in zip(cube_crpix, crpix)) > 1e-3:
        problems.append(f"reference pixel {cube_crpix} but the spot uses {tuple(crpix)}")
    if problems:
        raise ValueError(f"{bands_folder}/cube.fits is not on the spot's pixel grid: "
                         + "; ".join(problems) + ". Rebuild it with the spot's centre and --fov.")


def clipped_noise(plane):
    """Sigma-clipped standard deviation of a band over the whole spot (MJy/sr). Stars and
    the moving object are clipped away, so this is the noise of the sky."""
    from astropy.stats import sigma_clip
    vals = plane[np.isfinite(plane)].astype(np.float64)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return float(np.std(sigma_clip(vals, sigma=3, maxiters=5, masked=True).compressed()))


def export_spectrum_tiles(bands_folder, out_dir, tile=32):
    """Write out_dir/spectrum/index.json and out_dir/spectrum/t_<tx>_<ty>.u16; return the index.

    Only bands that have data are listed, so B = len(index["bands"]) can be less than 102
    (Eros has 100). Each entry keeps its real SPHEREx band number (1..102) in "band", so the
    list index is NOT the band number. Rows are top-down (the FITS rows are flipped here, once).
    Each band has its own linear scale and offset (MJy/sr = value * scale + offset) chosen as in
    export_web.quantize_plane: step at most noise / 2, and if the range is too wide the brightest
    pixels clip to 65534 and that band gets "clipped": true. 65535 means no data, and also pads
    the edge tiles. Old tiles in the spectrum folder are removed first."""
    from astropy.io import fits
    from export_web import quantize_plane
    with fits.open(os.path.join(bands_folder, "cube.fits")) as hdul:
        cube = np.asarray(hdul[0].data, dtype=np.float64)[:, ::-1, :]        # rows top-down
    with open(os.path.join(bands_folder, "bands.csv"), newline="") as f:
        rows = list(csv.DictReader(f))
    if len(rows) != cube.shape[0]:
        raise ValueError(f"{bands_folder}: bands.csv has {len(rows)} rows, cube has {cube.shape[0]} planes")
    h, w = cube.shape[1:]

    keep, entries, planes = [], [], []
    for i, r in enumerate(rows):
        if r["wavelength_um"] == "" or not np.isfinite(cube[i]).any():
            continue                                   # no image for this band
        noise = float(f"{clipped_noise(cube[i]):.5g}")      # the stored value is the one used
        q, scale, offset, clipped = quantize_plane(cube[i], max(noise, 1e-9))
        entry = {"band": int(r["band"]), "detector": int(r["detector"]),
                 "wavelength_um": float(r["wavelength_um"]), "bandwidth_um": float(r["bandwidth_um"]),
                 "date_obs": r["date_obs"][:19], "scale": scale, "offset": offset,
                 "noise": noise}
        if clipped:
            entry["clipped"] = True
        keep.append(i)
        entries.append(entry)
        planes.append(q)
    q = np.array(planes, dtype="<u2")                  # B x H x W
    nb = len(entries)
    nx, ny = -(-w // tile), -(-h // tile)

    spec = os.path.join(out_dir, "spectrum")
    if os.path.isdir(spec):
        shutil.rmtree(spec)
    os.makedirs(spec)
    for ty in range(ny):
        for tx in range(nx):
            block = np.full((nb, tile, tile), NODATA, dtype="<u2")
            part = q[:, ty * tile:(ty + 1) * tile, tx * tile:(tx + 1) * tile]
            block[:, :part.shape[1], :part.shape[2]] = part
            with open(os.path.join(spec, f"t_{tx}_{ty}.u16"), "wb") as f:
                f.write(block.tobytes())
    index = {"size": [w, h], "tile": tile, "nx": nx, "ny": ny, "origin": [0, 0],
             "covered": [w, h], "units": "MJy/sr", "nodata": NODATA, "bands": entries}
    with open(os.path.join(spec, "index.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, separators=(",", ":"))
        f.write("\n")
    return index
