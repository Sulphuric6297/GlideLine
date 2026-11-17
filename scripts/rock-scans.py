"""Rock textures: CC0 scans from Poly Haven (sources in public/rocks/SOURCES.md), each cut to 512 px.

  public/rocks/color.jpg, normal.jpg   the stones rocks are made of, one layer each in the order of
                                       three/rocks' STONE_LAYERS (their real color, and their bumps)
  public/ground/color-rock.jpg,        the rock surfaces' ground scans, layers 10 to 13 of
  normal-rock.jpg                      three/groundDetail's LAYERS (after the nine in color.jpg and
                                       normal.jpg, left as they are): bedrock, broken rock, rocky
                                       ground, cliff; as the others, color as a variation round its
                                       own average (128 the average)

Run with the scans (Poly Haven 1K jpgs, <id>_diff.jpg and <id>_nor_gl.jpg) in one folder:
  python scripts/rock-scans.py <scans> public
The ground's own strips (color.jpg, normal.jpg) are never written: courses made before keep them exactly.
Needs Pillow.
"""
import sys
from PIL import Image, ImageStat

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE = 512
STONES = ["rock_boulder_dry", "rock_3", "old_sandstone_02", "tiger_rock"]  # granite, fieldstone, sandstone, red granite
GROUND = ["rock_boulder_dry", "gray_rocks", "rocky_trail", "cliff_side"]   # bedrock, broken, rocky, cliff


def load(name):
    return Image.open(f"{SRC}/{name}").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)


# The stones: as they are
color = Image.new("RGB", (SIZE, SIZE * len(STONES)))
normal = Image.new("RGB", (SIZE, SIZE * len(STONES)))
stone_means = []
for i, s in enumerate(STONES):
    img = load(f"{s}_diff.jpg")
    stone_means.append([round(m) for m in ImageStat.Stat(img).mean])
    color.paste(img, (0, i * SIZE))
    normal.paste(load(f"{s}_nor_gl.jpg"), (0, i * SIZE))
color.save(f"{OUT}/rocks/color.jpg", quality=88, optimize=True)
normal.save(f"{OUT}/rocks/normal.jpg", quality=90, optimize=True)

# The rock surfaces' ground layers, in strips of their own
n = len(GROUND)
gc = Image.new("RGB", (SIZE, SIZE * n))
gn = Image.new("RGB", (SIZE, SIZE * n))
ground_means = []
for i, s in enumerate(GROUND):
    img = load(f"{s}_diff.jpg")
    mean = ImageStat.Stat(img).mean
    ground_means.append([round(m) for m in mean])
    bands = [b.point(lambda v, m=mean[k]: max(0, min(255, round(v * 128 / max(m, 1))))) for k, b in enumerate(img.split())]
    gc.paste(Image.merge("RGB", bands), (0, i * SIZE))
    gn.paste(load(f"{s}_nor_gl.jpg"), (0, i * SIZE))
gc.save(f"{OUT}/ground/color-rock.jpg", quality=88, optimize=True)
gn.save(f"{OUT}/ground/normal-rock.jpg", quality=90, optimize=True)
print("stone means", stone_means)
print("ground means", ground_means)
