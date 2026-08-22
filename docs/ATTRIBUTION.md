# Attribution

Where the pixel art in `frontend/public/sprites/` comes from, whether we are allowed to ship it,
and how to regenerate it.

## The pack

| What | Value |
|---|---|
| Pack | Pixel Crawler — Free Pack, version 2.11 |
| Author | Anokolisa |
| Source | https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites |
| Credit contact (per the terms) | AnomalyPixel@gmail.com |
| Author links | https://www.patreon.com/Anokolisa · https://twitter.com/Anokolisa |

## Are we allowed to ship it

Yes. The pack's `Terms.txt` says, verbatim:

- "It is not necessary to credit the author for any use of the arts, but if it is done it is appreciated."
- "The arts present can be altered in any shape, color or pattern" — but "Even after changes, these
  assets cannot be sold without authorization from the original creator, nor can they be marketed as
  a final product".
- "These arts cannot be sold as a final product, only the author can sell the assets".
- "You can use these assets in creating commercial products, study or any other project where they
  are functional".

ClassQuest is free and educational, so this use sits squarely inside those terms. The only
prohibition is selling the art. Credit is optional under the terms; we give it anyway, here and in
the header of `scripts/slice_sprites.py`.

## What is actually in the repo

**The pack is deliberately not vendored.** It is megabytes of art plus `.aseprite` sources and we
need about two dozen tiles. Only the 26 sprites the game uses are committed, under
`frontend/public/sprites/`.

`scripts/slice_sprites.py` is the provenance record: for every cut sprite it names the exact source
file in the pack and the exact pixel rectangle, and `frontend/public/sprites/manifest.json` carries
the same information next to the images (`"from": "Environment/Tilesets/Wall_Tiles.png@128,48"`).
Actor sheets are copied whole; the manifest records frame size and frame count instead of a
rectangle.

Two sprites are **not** from the pack and are the project's own work:

| Sprite | Why |
|---|---|
| `actors/mentor_owl_idle.png` | The mascot — it has to be ours |
| `props/signpost.png` | The pack has no signpost |

Both are drawn as 16x16 character pixel maps inside `scripts/slice_sprites.py` (`MENTOR_OWL`,
`SIGNPOST`) and rendered into a 32x32 frame, so they sit at the pack's actor scale.

## Regenerating the sprites

Download the pack from the itch.io link above and unzip it, then:

```bash
python3 scripts/slice_sprites.py ~/Downloads/"Pixel Crawler - Free Pack"
```

The argument is the pack directory — the one containing `Terms.txt`; the script exits if that file
is missing. It needs Pillow (`pip install pillow`), which is not part of the backend requirements
because this is a one-off tool. It rewrites every file under `frontend/public/sprites/` plus
`manifest.json`, and prints each sprite with its size and source.

## Naming

Sprite filenames follow the closed `actor`, `prop` and `background` enums in
`schema/game.schema.json`. That is why adding art is art work and not a schema change: the model
can only ever ask for a name the schema already allows, and the file it needs is on disk under
exactly that name.
