#!/usr/bin/env python3
"""Cut the sprites ClassQuest uses out of the Pixel Crawler asset pack.

The pack itself is NOT vendored: it is 2.4 MB of art plus .aseprite sources, and
we need about 20 tiles from it. This script is the provenance record — every
sprite in `frontend/public/sprites/` can be traced back to an exact rectangle of
an exact file in the pack, and re-cut on demand.

    python3 scripts/slice_sprites.py ~/Downloads/"Pixel Crawler - Free Pack"

Pack: Pixel Crawler (Free) by Anokolisa — https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites
Its Terms.txt permits use and modification in any project and forbids only
reselling the art. See docs/ATTRIBUTION.md.

`mentor_owl`, `signpost` and the player's `short_sword` are drawn here in code
rather than cut from the pack: the owl is the mascot and has to be ours, the
pack has no signpost, and the pack's weapons are drawn for a character roughly
twice this one's size -- its shortest sword is as tall as the explorer, so laid
against him it covers his head. See SHORT_SWORD below.
"""

import json
import sys
from pathlib import Path

from PIL import Image

TILE = 16
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "sprites"

# (destination, source file, x, y, w, h) — coordinates in source pixels.
CUTS = [
    # Terrain. One plain fill tile per surface; the world is built from these.
    ("tiles/floor_grass.png",     "Environment/Tilesets/Floors_Tiles.png",  32, 160, 16, 16),
    ("tiles/floor_sand.png",      "Environment/Tilesets/Floors_Tiles.png", 112, 160, 16, 16),
    ("tiles/floor_dirt.png",      "Environment/Tilesets/Floors_Tiles.png", 192, 160, 16, 16),
    ("tiles/floor_brick.png",     "Environment/Tilesets/Floors_Tiles.png", 256,  32, 16, 16),
    ("tiles/water.png",           "Environment/Tilesets/Water_tiles.png",   32, 192, 16, 16),
    # Walls come in two pieces: the top face you see from above and the vertical
    # face below it. A wall row is drawn as top + face so it reads as height.
    ("tiles/wall_stone_top.png",  "Environment/Tilesets/Wall_Tiles.png",   128,  48, 16, 16),
    ("tiles/wall_stone_face.png", "Environment/Tilesets/Wall_Tiles.png",   128,  96, 16, 16),
    ("tiles/wall_tan_top.png",    "Environment/Tilesets/Wall_Tiles.png",    32,  48, 16, 16),
    ("tiles/wall_tan_face.png",   "Environment/Tilesets/Wall_Tiles.png",    32,  96, 16, 16),
    ("tiles/wall_brown_top.png",  "Environment/Tilesets/Wall_Tiles.png",   224,  48, 16, 16),
    ("tiles/wall_brown_face.png", "Environment/Tilesets/Wall_Tiles.png",   224,  96, 16, 16),
    # Props named by the `prop` enum in schema/game.schema.json.
    ("props/doorway_pair.png",    "Environment/Props/Static/Dungeon_Props.png", 112,  0, 32, 32),
    # A stone archway with a hollow black interior. This is the portal frame:
    # the darkness inside is what the code-drawn vortex is painted onto, so the
    # arch reads as masonry around a hole rather than as a closed door.
    ("props/portal_arch.png",     "Environment/Tilesets/Dungeon_Tiles.png",       0, 160, 32, 48),
    ("props/lantern.png",         "Environment/Props/Static/Dungeon_Props.png",  64, 32, 16, 32),
    ("props/chest.png",           "Environment/Props/Static/Furniture.png",      48, 16, 32, 32),
    ("props/crystal_cluster.png", "Environment/Props/Static/Resources.png",      80, 16, 16, 16),
    # Scenery used to dress a world; not part of the enum.
    ("decor/rock.png",            "Environment/Props/Static/Rocks.png",          64, 16, 16, 16),
    ("decor/bookshelf.png",       "Environment/Tilesets/Dungeon_Tiles.png",     128, 64, 16, 32),
    ("decor/banner.png",          "Environment/Props/Static/Dungeon_Props.png",  64, 64, 16, 32),
]

# Actor sheets are copied whole; frame size is 32x32 and the frame count falls
# out of the sheet width. `explorer`/`rival`/`villager` are the `actor` enum.
ACTORS = {
    "explorer": "Rogue",
    "rival": "Knight",
    "villager": "Wizzard",
}
ACTOR_ANIMS = {"idle": "Idle", "run": "Run"}

# --- hand-drawn sprites -----------------------------------------------------
# 16x16 pixel maps, pasted centred into a 32x32 frame so they sit at the same
# scale as the pack's 32x32 actor frames.

PALETTE = {
    ".": None,                    # transparent
    "k": (28, 20, 14, 255),       # outline
    "b": (168, 118, 72, 255),     # feather mid
    "B": (120, 80, 48, 255),      # feather shadow
    "c": (232, 205, 168, 255),    # breast
    "e": (250, 204, 21, 255),     # iris (brand amber)
    "p": (20, 16, 12, 255),       # pupil
    "P": (255, 255, 255, 255),    # eye glint
    "y": (217, 119, 6, 255),      # beak / feet
    "w": (94, 62, 36, 255),       # post wood
    "W": (140, 96, 56, 255),      # sign board
    # Sword. Every colour below the blade is one the explorer sheet already
    # uses, sampled from it, so the weapon reads as part of the character
    # rather than as something pasted on top of him.
    "n": (20, 20, 18, 255),       # the sheet's own outline black
    "s": (214, 222, 238, 255),    # blade highlight
    "S": (140, 152, 178, 255),    # blade shade
    "t": (181, 108, 48, 255),     # the sheet's leather trim -- guard, pommel
    "T": (240, 154, 83, 255),     # its highlight
    "l": (71, 40, 13, 255),       # the sheet's dark leather -- grip
    "g": (55, 58, 32, 255),       # the sheet's garment shadow -- glove
}

MENTOR_OWL = [
    "................",
    "...k........k...",
    "..kbk......kbk..",
    "..kbbkkkkkkbbk..",
    ".kbbbbbbbbbbbbk.",
    ".kbeeeebbeeeebk.",
    ".kbepPeyyePpebk.",
    ".kbeeeeyyeeeebk.",
    ".kbbbbbyybbbbbk.",
    ".kbccccccccccbk.",
    ".kbccccccccccbk.",
    "..kbccccccccbk..",
    "..kbBccccccBbk..",
    "...kbbbbbbbbk...",
    "....kyykkyyk....",
    "................",
]

SIGNPOST = [
    "................",
    "................",
    "..kkkkkkkkkkk...",
    "..kWWWWWWWWWk...",
    "..kWkkWkkkWWk...",
    "..kWWWWWWWWWk...",
    "..kWkkkWkkWWk...",
    "..kWWWWWWWWWk...",
    "..kkkkkkkkkkk...",
    "......kwwk......",
    "......kwwk......",
    "......kwwk......",
    "......kwwk......",
    "......kwwk......",
    ".....kkwwkk.....",
    "................",
]


#: The explorer carries nothing: the pack ships hands and weapons as separate
#: layers meant to be composited per animation frame, and we do not have the
#: rig offsets that would place them. So he is drawn empty-handed, and at 16px
#: that reads as a hero with no hands at all.
#:
#: This is the smallest fix that is honest about it: a short sword at his hip,
#: with a gloved fist closed on the grip. It is one still, anchored to the
#: bottom centre of the frame -- the one point both the 32px idle sheet and the
#: 64px run sheet agree on -- so it rides every frame of both without needing
#: per-frame offsets. It does not swing, because nothing in this game swings.
SHORT_SWORD = [
    "................",
    "................",
    "................",
    "......n.........",
    "......nsn.......",
    "......nsSn......",
    "......nsSn......",
    "......nsSn......",
    "......nsSn......",
    ".....nTttTn.....",
    ".....ngggn......",
    ".....ngggn......",
    "......nln.......",
    "......ntn.......",
    ".......n........",
    "................",
]


def draw(rows, size=32):
    """Render a 16x16 character map centred in a `size` frame."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    ox = oy = (size - TILE) // 2
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            colour = PALETTE[ch]
            if colour:
                px[ox + x, oy + y] = colour
    return img


def main(pack_dir):
    pack = Path(pack_dir).expanduser()
    if not (pack / "Terms.txt").exists():
        sys.exit(f"not a Pixel Crawler pack directory: {pack}")

    manifest = {}
    sheets = {}

    for dest, src, x, y, w, h in CUTS:
        if src not in sheets:
            sheets[src] = Image.open(pack / src).convert("RGBA")
        out = OUT / dest
        out.parent.mkdir(parents=True, exist_ok=True)
        sheets[src].crop((x, y, x + w, y + h)).save(out)
        manifest[dest] = {"w": w, "h": h, "from": f"{src}@{x},{y}"}

    for actor, folder in ACTORS.items():
        for anim, sub in ACTOR_ANIMS.items():
            src = pack / "Entities" / "Npc's" / folder / sub / f"{sub}-Sheet.png"
            sheet = Image.open(src).convert("RGBA")
            dest = f"actors/{actor}_{anim}.png"
            (OUT / "actors").mkdir(parents=True, exist_ok=True)
            sheet.save(OUT / dest)
            manifest[dest] = {
                "w": sheet.width, "h": sheet.height,
                "frame": sheet.height, "frames": sheet.width // sheet.height,
                "from": f"Entities/Npc's/{folder}/{sub}",
            }

    # (destination, rows, frame size). The sword is not padded out to 32:
    # it is a still laid over an actor, not an actor, so it is exactly its own
    # size and carries no frame count.
    for name, rows, size in (
        ("actors/mentor_owl_idle.png", MENTOR_OWL, 32),
        ("props/signpost.png", SIGNPOST, 32),
        ("gear/short_sword.png", SHORT_SWORD, 16),
    ):
        img = draw(rows, size)
        (OUT / name).parent.mkdir(parents=True, exist_ok=True)
        img.save(OUT / name)
        entry = {"w": size, "h": size, "from": "drawn in scripts/slice_sprites.py"}
        if size == 32:
            entry |= {"frame": 32, "frames": 1}
        manifest[name] = entry

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"wrote {len(manifest)} sprites to {OUT}")
    for k in sorted(manifest):
        m = manifest[k]
        print(f"  {k:34} {m['w']:>3}x{m['h']:<3} {m.get('frames', '')!s:>2}f  {m['from']}")


main(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
