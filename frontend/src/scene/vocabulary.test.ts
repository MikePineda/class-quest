/**
 * The vocabulary is pure data, so the only things worth testing are the ones a
 * typo can break at runtime: a missing enum entry, a `src` that points at no
 * file, and a size that disagrees with the sliced art.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { Actor, Background, Prop } from '../api/types'
import type { Still } from './types'
import { ACTORS, BIOMES, PLAYER_GEAR, PROPS, actorArt, biomeFor, propArt } from './vocabulary'

/** Literal lists of every enum value. A schema change has to be mirrored here too. */
const BACKGROUNDS: Background[] = ['cavern', 'forest_path', 'ruins', 'observatory', 'shore', 'village']
const ACTOR_NAMES: Actor[] = ['explorer', 'mentor_owl', 'rival', 'villager']
const PROP_NAMES: Prop[] = ['doorway_pair', 'chart_frame', 'lantern', 'crystal_cluster', 'chest', 'signpost']

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url))

interface ManifestEntry {
  w: number
  h: number
  frame?: number
  frames?: number
}

const manifest: Record<string, ManifestEntry> = JSON.parse(
  readFileSync(`${PUBLIC_DIR}sprites/manifest.json`, 'utf8'),
)

/** `/sprites/tiles/rock.png` -> the key the manifest uses, `tiles/rock.png`. */
const manifestKey = (src: string) => src.replace('/sprites/', '')

/** Every still declared anywhere in the vocabulary, labelled for readable failures. */
const stills: Array<[string, Still]> = BACKGROUNDS.flatMap((name) => {
  const biome = BIOMES[name]
  return [
    [`${name}.floor`, biome.floor],
    [`${name}.wallTop`, biome.wallTop],
    [`${name}.wallFace`, biome.wallFace],
    ...biome.decor.map((d, i): [string, Still] => [`${name}.decor[${i}]`, d]),
  ] as Array<[string, Still]>
}).concat(
  PROP_NAMES.flatMap((name): Array<[string, Still]> => {
    const art = PROPS[name]
    return art.kind === 'sprite' ? [[`prop.${name}`, art.sprite]] : []
  }),
)

/** Every animation sheet declared anywhere in the vocabulary. */
const anims = ACTOR_NAMES.flatMap((name) => {
  const art = ACTORS[name]
  const entries = [{ label: `${name}.idle`, anim: art.idle }]
  if (art.run) entries.push({ label: `${name}.run`, anim: art.run })
  return entries
})

const allSrcs = [
  ...stills.map(([, s]) => s.src),
  ...anims.map((a) => a.anim.src),
  PLAYER_GEAR.sprite.src,
]

describe('exhaustiveness', () => {
  it.each(BACKGROUNDS)('resolves the %s biome', (name) => {
    const biome = biomeFor(name)
    expect(biome).toBeDefined()
    expect(biome.floor.src).toBeTruthy()
    expect(biome.wallTop.src).toBeTruthy()
    expect(biome.wallFace.src).toBeTruthy()
    expect(biome.tint).toMatch(/^rgba?\(/)
  })

  it.each(ACTOR_NAMES)('resolves the %s actor', (name) => {
    const art = actorArt(name)
    expect(art).toBeDefined()
    expect(art.idle.src).toBeTruthy()
  })

  it.each(PROP_NAMES)('resolves the %s prop', (name) => {
    expect(propArt(name)).toBeDefined()
  })

  it('declares no entry beyond the enums', () => {
    expect(Object.keys(BIOMES).sort()).toEqual([...BACKGROUNDS].sort())
    expect(Object.keys(ACTORS).sort()).toEqual([...ACTOR_NAMES].sort())
    expect(Object.keys(PROPS).sort()).toEqual([...PROP_NAMES].sort())
  })
})

describe('art on disk', () => {
  it.each(allSrcs)('%s is served from /sprites and exists', (src) => {
    expect(src.startsWith('/sprites/')).toBe(true)
    expect(existsSync(`${PUBLIC_DIR}${src.slice(1)}`)).toBe(true)
  })

  it.each(stills)('%s matches the manifest size', (_label, sprite) => {
    const entry = manifest[manifestKey(sprite.src)]
    expect(entry).toBeDefined()
    expect({ w: sprite.w, h: sprite.h }).toEqual({ w: entry.w, h: entry.h })
  })

  it.each(anims)('$label matches the manifest frames', ({ anim }) => {
    const entry = manifest[manifestKey(anim.src)]
    expect(entry).toBeDefined()
    expect({ frame: anim.frame, frames: anim.frames }).toEqual({
      frame: entry.frame,
      frames: entry.frames,
    })
    // The sheet is one row of square frames, so its declared width must add up.
    expect(entry.w).toBe(anim.frame * anim.frames)
    expect(entry.h).toBe(anim.frame)
    expect(anim.fps).toBeGreaterThan(0)
  })
})

describe('the special cases', () => {
  it('gives the mentor owl an idle but no run', () => {
    expect(ACTORS.mentor_owl.run).toBeUndefined()
    expect(ACTORS.mentor_owl.idle.frames).toBe(1)
  })

  it.each<Actor>(['explorer', 'rival', 'villager'])('gives %s a run sheet', (name) => {
    expect(actorArt(name).run).toBeDefined()
  })

  it("keeps the player's kit out of the content enums", () => {
    // It is a client-side idea about the hero. A schema that knew about it
    // would be a schema the model could put a sword in.
    expect(PROP_NAMES).not.toContain('short_sword' as never)
    expect(PLAYER_GEAR.sprite.src).toBe('/sprites/gear/short_sword.png')
  })

  it("matches the manifest for the player's kit", () => {
    const entry = manifest[manifestKey(PLAYER_GEAR.sprite.src)]
    expect(entry).toBeDefined()
    expect({ w: PLAYER_GEAR.sprite.w, h: PLAYER_GEAR.sprite.h }).toEqual({ w: entry.w, h: entry.h })
    // A still, not a sheet: a frame count here would mean somebody expected it
    // to animate, and nothing in this game swings.
    expect(entry.frames).toBeUndefined()
  })

  it('holds the sword off the floor and to one side', () => {
    // Flush with the floor it hangs off his ankle; too high and the tip goes
    // through his scarf. The numbers are the ones that were eyeballed against
    // every frame of both sheets, so a change to them is a change to be looked at.
    expect(PLAYER_GEAR.offset).toEqual({ x: -3, y: 2 })
  })

  it('draws chart_frame in code and everything else as a sprite', () => {
    const components = PROP_NAMES.filter((name) => PROPS[name].kind === 'component')
    expect(components).toEqual(['chart_frame'])
    expect(propArt('chart_frame')).toEqual({ kind: 'component', component: 'chart_frame' })
  })
})
