"""Rock textures: CC0 scans from Poly Haven (sources in public/rocks/SOURCES.md), each cut to 512 px.

  public/rocks/color.jpg, normal.jpg   the stones rocks are made of, one layer each in the order of
                                       three/rocks' STONE_LAYERS (their real color, and their bumps)
  public/ground/color.jpg, normal.jpg  the ground's scans with the rock surfaces' added after the nine
                                       already there (three/groundDetail's LAYERS): bedrock, broken
                                       rock, rocky ground, cliff; as the others, color as a variation
                                       round its own average (128 the average)

Run with the scans (Poly Haven 1K jpgs, <id>_diff.jpg and <id>_nor_gl.jpg) in one folder:
  python scripts/rock-scans.py <scans> public
It reads the ground's nine layers from public/ground and writes them back with the four after.
Needs Pillow.
"""
import sys
from PIL import Image, ImageStat

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE = 512
STONES = ["rock_boulder_dry", "rock_3", "old_sandstone_02", "tiger_rock"]  # granite, fieldstone, sandstone, red granite
GROUND = ["rock_boulder_dry", "gray_rocks", "rocky_trail", "cliff_side"]   # bedrock, broken, rocky, cliff
GROUND_KEEP = 9


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

# The ground: the nine there, then the rock surfaces
old_c = Image.open(f"{OUT}/ground/color.jpg").convert("RGB")
old_n = Image.open(f"{OUT}/ground/normal.jpg").convert("RGB")
n = GROUND_KEEP + len(GROUND)
gc = Image.new("RGB", (SIZE, SIZE * n))
gn = Image.new("RGB", (SIZE, SIZE * n))
gc.paste(old_c.crop((0, 0, SIZE, SIZE * GROUND_KEEP)), (0, 0))
gn.paste(old_n.crop((0, 0, SIZE, SIZE * GROUND_KEEP)), (0, 0))
ground_means = []
for i, s in enumerate(GROUND):
    img = load(f"{s}_diff.jpg")
    mean = ImageStat.Stat(img).mean
    ground_means.append([round(m) for m in mean])
    bands = [b.point(lambda v, m=mean[k]: max(0, min(255, round(v * 128 / max(m, 1))))) for k, b in enumerate(img.split())]
    gc.paste(Image.merge("RGB", bands), (0, (GROUND_KEEP + i) * SIZE))
    gn.paste(load(f"{s}_nor_gl.jpg"), (0, (GROUND_KEEP + i) * SIZE))
gc.save(f"{OUT}/ground/color.jpg", quality=88, optimize=True)
gn.save(f"{OUT}/ground/normal.jpg", quality=90, optimize=True)
print("stone means", stone_means)
print("ground means", ground_means)
