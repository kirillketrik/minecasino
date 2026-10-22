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
