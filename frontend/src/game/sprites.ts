/**
 * All art is drawn here in code: 16x16 pixel textures, original to this project.
 * Blocks are generated from a seeded palette so every symbol keeps one stable look.
 */
import { Texture } from 'pixi.js'

export type SpriteName =
  // Шахта
  | 'coal' | 'iron' | 'gold' | 'diamond' | 'pickaxe' | 'dynamite' | 'crystal-red' | 'crystal-blue'
  // Крипер
  | 'gunpowder' | 'redstone' | 'lapis' | 'emerald' | 'skull' | 'creeper' | 'portal'
  // Элитры
  | 'elytra' | 'stone' | 'cave'
  // Врата Края
  | 'chorus' | 'endstone' | 'obsidian' | 'pearl' | 'eye' | 'shulker' | 'wings' | 'head' | 'egg' | 'crystal' | 'endwall'
  // Бурение
  | 'dirt' | 'chest' | 'chestopen' | 'drill'

const SIZE = 16

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Ctx = CanvasRenderingContext2D

function make(draw: (c: Ctx) => void, w = SIZE, h = SIZE): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  draw(ctx)
  return canvas
}

const px = (c: Ctx, color: string, x: number, y: number, w = 1, h = 1) => {
  c.fillStyle = color
  c.fillRect(x, y, w, h)
}

function noise(c: Ctx, colors: string[], r: () => number) {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) px(c, colors[Math.floor(r() * colors.length)], x, y)
}

/** A block face: noisy fill with a darker rim, so neighbours read as separate cubes. */
function block(c: Ctx, fill: string[], rim: string, r: () => number) {
  noise(c, fill, r)
  c.fillStyle = rim
  c.fillRect(0, 0, SIZE, 1)
  c.fillRect(0, SIZE - 1, SIZE, 1)
  c.fillRect(0, 0, 1, SIZE)
  c.fillRect(SIZE - 1, 0, 1, SIZE)
}

const STONE = ['#6c6f77', '#62656c', '#777a82', '#595c63']

function ore(seed: number, spots: string[], count = 7, base = STONE, rim = '#3f4147') {
  return make((c) => {
    const r = rng(seed)
    block(c, base, rim, r)
    for (let i = 0; i < count; i++) {
      const x = 2 + Math.floor(r() * 10)
      const y = 2 + Math.floor(r() * 10)
      const w = 2 + Math.floor(r() * 2)
      const h = 2 + Math.floor(r() * 2)
      const color = spots[Math.floor(r() * spots.length)]
      px(c, color, x, y, Math.min(w, 14 - x), Math.min(h, 14 - y))
    }
  })
}

/** ASCII bitmap: each character is a key into `palette`, '.' is transparent. */
function bitmap(rows: string[], palette: Record<string, string>) {
  return make(
    (c) =>
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch !== '.' && palette[ch]) px(c, palette[ch], x, y)
        }),
      ),
    SIZE,
    rows.length,
  )
}

const builders: Record<SpriteName, () => HTMLCanvasElement> = {
  coal: () => ore(11, ['#18181b', '#2a2a30', '#111113'], 8),
  iron: () => ore(23, ['#d9b9a3', '#c49b83', '#e6cdbb'], 7),
  gold: () => ore(37, ['#f7d84c', '#e9b52b', '#fff0a0'], 7),
  diamond: () => ore(41, ['#4fe3dc', '#9ff6f1', '#2bb8b6'], 7),
  redstone: () => ore(53, ['#d92d2d', '#ff6150', '#8e1414'], 9),
  lapis: () => ore(67, ['#2c55c6', '#4d7fe9', '#1d3a8f'], 8),
  emerald: () => ore(71, ['#2ed56a', '#7bf2a3', '#16974a'], 7),
  gunpowder: () =>
    make((c) => {
      const r = rng(83)
      block(c, ['#2a2c32', '#26282d', '#2e3037'], '#1a1b1f', r)
      for (let i = 0; i < 22; i++) {
        const color = ['#8a8a90', '#5d5d63', '#b0b0b6', '#707076'][Math.floor(r() * 4)]
        px(c, color, 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), 1)
      }
    }),
  skull: () =>
    bitmap(
      [
        'oooooooooooooooo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obbddddbbddddbbo',
        'obbddddbbddddbbo',
        'obbddddbbddddbbo',
        'obbbbbbddbbbbbbo',
        'obbbbbbddbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obbbdbdbdbdbdbbo',
        'obbbdbdbdbdbdbbo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'obbbbbbbbbbbbbbo',
        'oooooooooooooooo',
      ],
      { o: '#8d8873', b: '#e8e4d2', d: '#2a2820' },
    ),
  creeper: () =>
    make((c) => {
      const r = rng(97)
      block(c, ['#5aaa48', '#4c9840', '#6dbd58', '#438a38'], '#2c5e24', r)
      // Round pits for eyes, a wide grin with two fangs.
      const dark = '#14180f'
      px(c, dark, 3, 4, 3, 3)
      px(c, dark, 10, 4, 3, 3)
      px(c, dark, 4, 5, 1, 1)
      px(c, '#6dbd58', 4, 5, 1, 1)
      px(c, '#6dbd58', 11, 5, 1, 1)
      px(c, dark, 3, 9, 10, 1)
      px(c, dark, 2, 10, 12, 2)
      px(c, '#e8f1de', 5, 10, 1, 2)
      px(c, '#e8f1de', 10, 10, 1, 2)
    }),
  // Original portal: dark frame around a purple field with lighter streaks.
  portal: () =>
    make((c) => {
      const r = rng(131)
      block(c, ['#2a1745', '#22123a', '#321d52'], '#120a22', r)
      for (let y = 3; y < 13; y++)
        for (let x = 3; x < 13; x++) px(c, ['#7a2fd6', '#8e46ea', '#6a22c2'][Math.floor(r() * 3)], x, y)
      for (let i = 0; i < 9; i++) px(c, ['#d9a1ff', '#c07cff'][i % 2], 3 + Math.floor(r() * 9), 3 + Math.floor(r() * 9), 1, 1 + Math.floor(r() * 2))
    }),
  pickaxe: () =>
    bitmap(
      [
        '......gggggg....',
        '....ggGGGGGGgg..',
        '...gGgcc....gGg.',
        '..gGg.....bBGgg.',
        '..gG.....bB..gG.',
        '.gg.....bB...gg.',
        '.g.....bB.....g.',
        '......bB........',
        '.....bB.........',
        '....bB..........',
        '...bB...........',
        '..bB............',
        '.bB.............',
        'bB..............',
        '................',
        '................',
      ],
      { g: '#c4c9d1', G: '#8c929c', c: '#f2f4f8', b: '#9a6a34', B: '#5f3d1a' },
    ),
  dynamite: () =>
    bitmap(
      [
        '.......yy.......',
        '......y.........',
        '.....kk.........',
        '..rrrrrrrrrrrr..',
        '..rRRRRRRRRRRr..',
        '..rRRRRRRRRRRr..',
        '..wwwwwwwwwwww..',
        '..wkwkwkwkwkww..',
        '..wwwwwwwwwwww..',
        '..rRRRRRRRRRRr..',
        '..rRRRRRRRRRRr..',
        '..rrrrrrrrrrrr..',
        '..rrrrrrrrrrrr..',
        '................',
        '................',
        '................',
      ],
      { r: '#b92d2d', R: '#e04545', w: '#e8dcb8', k: '#2a2622', y: '#f7c948' },
    ),
  'crystal-red': () =>
    bitmap(
      [
        '................',
        '.......rr.......',
        '......rRRr......',
        '.....rRhRRr.....',
        '....rRhRRRRr....',
        '...rRhRRRRRRr...',
        '..rRRRRRRRRRRr..',
        '..rRRRRRRRRRdr..',
        '...rRRRRRRRdr...',
        '....rRRRRRdr....',
        '.....rRRRdr.....',
        '......rRdr......',
        '.......rr.......',
        '................',
        '................',
        '................',
      ],
      { r: '#7d1414', R: '#e5484d', h: '#ff9a94', d: '#a82a2a' },
    ),
  'crystal-blue': () =>
    bitmap(
      [
        '................',
        '.......bb.......',
        '......bBBb......',
        '.....bBhBBb.....',
        '....bBhBBBBb....',
        '...bBhBBBBBBb...',
        '..bBBBBBBBBBBb..',
        '..bBBBBBBBBBdb..',
        '...bBBBBBBBdb...',
        '....bBBBBBdb....',
        '.....bBBBdb.....',
        '......bBdb......',
        '.......bb.......',
        '................',
        '................',
        '................',
      ],
      { b: '#173a8f', B: '#5b8cf0', h: '#b6cdff', d: '#3a63c4' },
    ),
  elytra: () =>
    bitmap(
      [
        '................',
        '.pp..........pp.',
        '.pPp........pPp.',
        'pPPPp......pPPPp',
        'pPPPPpp..ppPPPPp',
        'pPhPPPPppPPPPhPp',
        '.pPPPPPPPPPPPPp.',
        '..pPPPPPPPPPPp..',
        '...ppPPPPPPpp...',
        '.....ppPPpp.....',
        '.......pp.......',
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
      { p: '#3b3552', P: '#6d6592', h: '#a39cc8' },
    ),
  stone: () => make((c) => block(c, ['#34373e', '#30333a', '#383b43'], '#26282d', rng(5))),
  cave: () => make((c) => block(c, ['#23252b', '#202228', '#272a30', '#1d1f24'], '#181a1e', rng(9))),
  // Врата Края
  chorus: () =>
    make((c) => {
      const r = rng(151)
      block(c, ['#8f6aa3', '#82599a', '#9c78b0', '#76508d'], '#4b2f5e', r)
      for (let i = 0; i < 14; i++) px(c, ['#d7b6ea', '#b48ad0', '#5a3a70'][i % 3], 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), 1)
    }),
  endstone: () =>
    make((c) => {
      const r = rng(163)
      block(c, ['#e3e0a8', '#d9d69b', '#ecebb9', '#cfcc8c'], '#8f8c5c', r)
      for (let i = 0; i < 8; i++) px(c, ['#f6f4d0', '#bdb97a'][i % 2], 2 + Math.floor(r() * 11), 2 + Math.floor(r() * 11), 2, 1)
    }),
  obsidian: () =>
    make((c) => {
      const r = rng(173)
      block(c, ['#1b1030', '#150c26', '#24153f', '#110920'], '#0a0514', r)
      for (let i = 0; i < 7; i++) px(c, ['#4b2c80', '#6a3fb0'][i % 2], 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1, 1 + Math.floor(r() * 2))
    }),
  pearl: () =>
    bitmap(
      [
        '................',
        '......oooooo....',
        '....ooggGGggoo..',
        '...ogGGGhhGGGgo.',
        '..ogGGGhhGGGGGgo',
        '..ogGGGGGGGGGGgo',
        '..ogGGGGGGGGGGgo',
        '..ogGGGGGGGGGGgo',
        '..ogGGGGGGGGGGgo',
        '...ogGGGGGGGGgo.',
        '...oggGGGGGGggo.',
        '....ooggggggoo..',
        '......oooooo....',
        '................',
        '................',
        '................',
      ],
      { o: '#0d3b33', g: '#1f8f7a', G: '#34c9a8', h: '#b5f7e8' },
    ),
  eye: () =>
    bitmap(
      [
        '................',
        '......oooooo....',
        '....ooggGGggoo..',
        '...ogGGGGGGGGgo.',
        '..ogGGGGyyGGGGgo',
        '..ogGGGyykyGGGgo',
        '..ogGGyykkkyGGgo',
        '..ogGGyykkkyGGgo',
        '..ogGGGyykyGGGgo',
        '...ogGGGyyGGGgo.',
        '...oggGGGGGGggo.',
        '....ooggggggoo..',
        '......oooooo....',
        '................',
        '................',
        '................',
      ],
      { o: '#17331f', g: '#2f8a4a', G: '#4fc46f', y: '#f0b43a', k: '#1a0f24' },
    ),
  shulker: () =>
    bitmap(
      [
        '................',
        '................',
        '...oooooooooo...',
        '..oLLLLLLLLLLo..',
        '..oLllllllllLo..',
        '..oooooooooooo..',
        '..oBBBBBBBBBBo..',
        '..oBkkkBBkkkBo..',
        '..oBkykBBkykBo..',
        '..oBkkkBBkkkBo..',
        '..oBBBBBBBBBBo..',
        '..oooooooooooo..',
        '................',
        '................',
        '................',
        '................',
      ],
      { o: '#4a2a63', L: '#a572c4', l: '#c79be0', B: '#8e5eae', k: '#1a0f24', y: '#f2e36b' },
    ),
  wings: () =>
    bitmap(
      [
        '................',
        '.pp..........pp.',
        '.pPp........pPp.',
        'pPPPp......pPPPp',
        'pPPPPpp..ppPPPPp',
        'pPhPPPPppPPPPhPp',
        '.pPPPPPPPPPPPPp.',
        '..pPPPPPPPPPPp..',
        '...ppPPPPPPpp...',
        '.....ppPPpp.....',
        '.......pp.......',
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
      { p: '#2b6f7a', P: '#5fd0d6', h: '#d4fdff' },
    ),
  head: () =>
    make((c) => {
      const r = rng(181)
      block(c, ['#16101f', '#120c1b', '#1b1427'], '#0a0710', r)
      px(c, '#8a7aa0', 1, 1, 2, 3)
      px(c, '#8a7aa0', 13, 1, 2, 3)
      px(c, '#d27bff', 3, 5, 3, 2)
      px(c, '#d27bff', 10, 5, 3, 2)
      px(c, '#ffffff', 4, 5, 1, 1)
      px(c, '#ffffff', 11, 5, 1, 1)
      px(c, '#4b2c80', 6, 9, 1, 2)
      px(c, '#4b2c80', 9, 9, 1, 2)
      for (const x of [3, 6, 9, 12]) px(c, '#e8e4d2', x, 12, 1, 2)
    }),
  egg: () =>
    bitmap(
      [
        '................',
        '.......oo.......',
        '......oBBo......',
        '.....oBBpBo.....',
        '.....oBBBBo.....',
        '....oBpBBBBo....',
        '....oBBBBpBo....',
        '...oBBBpBBBBo...',
        '...oBBBBBBpBo...',
        '...oBpBBBBBBo...',
        '...oBBBBBpBBo...',
        '....oBBpBBBo....',
        '....oBBBBBBo....',
        '.....oBBBBo.....',
        '......oooo......',
        '................',
      ],
      { o: '#6a3fb0', B: '#14091f', p: '#b86bff' },
    ),
  crystal: () =>
    bitmap(
      [
        '.......mm.......',
        '......mMMm......',
        '.....mMwwMm.....',
        '....mMwWWwMm....',
        '...mMwWccWwMm...',
        '..mMwWccccWwMm..',
        '..mMwWccccWwMm..',
        '...mMwWccWwMm...',
        '....mMwWWwMm....',
        '.....mMwwMm.....',
        '......mMMm......',
        '.......mm.......',
        '................',
        '................',
        '................',
        '................',
      ],
      { m: '#7a1f6e', M: '#e04fc0', w: '#f59be0', W: '#ffd6f4', c: '#ffffff' },
    ),
  endwall: () => make((c) => block(c, ['#241a38', '#20162f', '#281d3f', '#1b1329'], '#150e22', rng(19))),
  // Бурение
  dirt: () =>
    make((c) => {
      const r = rng(211)
      block(c, ['#8a5a36', '#7c4f2e', '#955f3a', '#6f4527'], '#4a2e18', r)
      for (let i = 0; i < 7; i++) px(c, ['#a8714a', '#5a381e'][i % 2], 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + Math.floor(r() * 2), 1)
    }),
  chest: () =>
    bitmap(
      [
        '................',
        '................',
        '..bbbbbbbbbbbb..',
        '.bBBBBBBBBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.kkkkkkyykkkkkk.',
        '.bBBBBByyBBBBBb.',
        '.bBBBBByyBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.bbbbbbbbbbbbbb.',
        '................',
        '................',
        '................',
        '................',
      ],
      { b: '#5f3d1a', B: '#9a6a34', k: '#2a2622', y: '#f7c948' },
    ),
  chestopen: () =>
    bitmap(
      [
        '..bbbbbbbbbbbb..',
        '.bBBBBBBBBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.bbbbbbbbbbbbbb.',
        '.kkkkkkkkkkkkkk.',
        '.kyyyyfyyyyfyyk.',
        '.kyfyyyyyfyyyyk.',
        '.kkkkkkkkkkkkkk.',
        '.bBBBBBBBBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.bBBBBBBBBBBBBb.',
        '.bbbbbbbbbbbbbb.',
        '................',
        '................',
        '................',
        '................',
      ],
      { b: '#5f3d1a', B: '#9a6a34', k: '#2a2622', y: '#f7c948', f: '#fff0a0' },
    ),
  drill: () =>
    bitmap(
      [
        '.....cc.........',
        '....cCCc........',
        '...cCggCc.......',
        '...cgGGgc.......',
        '....cgGgc.......',
        '....cgGgc.......',
        '...cgGGggc......',
        '...cgGgGgc......',
        '..cCgGGgGCc.....',
        '..ccggGGggcc....',
        '...ccgGgcc......',
        '....ccgcc.......',
        '.....cyc........',
        '.....yyy........',
        '....yYYYy.......',
        '....yyyyy.......',
      ],
      { c: '#f2f4f8', C: '#c4c9d1', g: '#8c929c', G: '#5d636d', y: '#e9b52b', Y: '#b88a1a' },
    ),
}

const cache = new Map<SpriteName, HTMLCanvasElement>()
const textures = new Map<SpriteName, Texture>()

export function canvasOf(name: SpriteName): HTMLCanvasElement {
  let canvas = cache.get(name)
  if (!canvas) {
    canvas = builders[name]()
    cache.set(name, canvas)
  }
  return canvas
}

export function textureOf(name: SpriteName): Texture {
  let tex = textures.get(name)
  if (!tex) {
    tex = Texture.from(canvasOf(name))
    tex.source.scaleMode = 'nearest'
    textures.set(name, tex)
  }
  return tex
}

const urls = new Map<string, string>()
/** A crisp upscaled data URL for plain DOM use (lobby art, paytable). */
export function dataUrl(name: SpriteName, scale = 4): string {
  const key = `${name}@${scale}`
  let url = urls.get(key)
  if (!url) {
    const src = canvasOf(name)
    const big = document.createElement('canvas')
    big.width = src.width * scale
    big.height = src.height * scale
    const ctx = big.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(src, 0, 0, big.width, big.height)
    url = big.toDataURL()
    urls.set(key, url)
  }
  return url
}
