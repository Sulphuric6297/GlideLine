"""The buildings' wall and roof textures (public/buildings/): CC0 scans from Poly Haven and ambientCG,
each cut to a square tile of known size and made small for the web.

  <key>.jpg         its color, 1024 px (as it is: "Natural"), its photo's uneven light evened out
  <key>-normal.jpg  its bumps (an OpenGL normal map), 512 px, so the sun lights them
  <key>-detail.jpg  its light and dark round mid-gray, 128 px: a swatch shows a color painted on it
                    (overlaid on the color)
  textures.json     each one's size in ft (one tile), its average brightness (linear) for painting it
                    a color (three/buildingLook's shader keeps its light and dark round that average)

Run with the scans downloaded into one folder, each scan's 1K files as its site names them
(python3 scripts/building-textures.py <scans> public/buildings); the sources are listed in
public/buildings/SOURCES.md. Needs Pillow and numpy.
"""
import json, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
# key: (scan, its color file's ending, its normal's, the crop (px of the 1K scan, square), the crop's
# size in ft, how much of its light and dark it keeps painted)
SCANS = {
    # walls
    "lap": ("WoodSiding009", "_color.jpg", "_normal.jpg", (0, 0, 512, 512), 3.35, 0.7),
    "board": ("wood_planks_grey", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 4.9, 0.45),
    "brick": ("red_brick_03", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 3.3, 0.55),
    "stone": ("rustic_stone_wall_02", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 4.9, 0.85),
    "stucco": ("Plaster002", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 6.0, 0.5),
    "metal": ("corrugated_iron", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 3.7, 0.5),
    # roofs
    "shingles": ("grey_roof_01", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 13.0, 0.6),
    "slate": ("roof_slates_02", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 9.8, 0.6),
    "clay": ("clay_roof_tiles_02", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 8.2, 0.6),
    "roofmetal": ("box_profile_metal_sheet", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 6.6, 0.45),
    "shakes": ("roof_09", "_color.jpg", "_normal.jpg", (0, 0, 1024, 1024), 13.0, 0.6),
}

lin = lambda a: np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
info = {}
for key, (scan, ce, ne, crop, ft, keep) in SCANS.items():
    color = Image.open(f"{SRC}/{scan}{ce}").convert("RGB").crop(crop).resize((1024, 1024), Image.LANCZOS)
    # (the photo's uneven light evened out: its broad patches, which show as a checker where it
    # repeats across a roof, divided away; the boards, bricks and shingles kept)
    c = np.asarray(color, dtype=float)
    broad = np.asarray(color.resize((16, 16), Image.BOX).resize((1024, 1024), Image.BICUBIC), dtype=float)
    lum = lambda x: x @ [0.299, 0.587, 0.114]
    k = (lum(c.reshape(-1, 3)).mean() / np.maximum(lum(broad), 1))[..., None]
    color = Image.fromarray(np.clip(c * k, 0, 255).astype(np.uint8))
    color.save(f"{OUT}/{key}.jpg", quality=84, optimize=True, progressive=True)
    Image.open(f"{SRC}/{scan}{ne}").convert("RGB").crop(crop).resize((512, 512), Image.LANCZOS).save(f"{OUT}/{key}-normal.jpg", quality=88, optimize=True)
    a = lin(np.asarray(color, dtype=float) / 255)
    g = np.asarray(color.convert("L").resize((128, 128), Image.LANCZOS), dtype=float)
    Image.fromarray(np.clip(128 + (g - g.mean()) * keep, 0, 255).astype(np.uint8)).save(f"{OUT}/{key}-detail.jpg", quality=85)
    avg = float((a * [0.2126, 0.7152, 0.0722]).sum(axis=2).mean())
    info[key] = {"ft": ft, "avg": round(avg, 4), "keep": keep}
    print(key, info[key])
json.dump(info, open(f"{OUT}/textures.json", "w"), indent=1)
