/**
 * All art is drawn here in code, original to this project. Every sprite is a 32x32 canvas shown at a
 * logical 16x16 (texture resolution 2): scenes keep their 16px grid while the art carries twice the
 * detail: lit and shaded volumes, facets, ore clusters and a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js'

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

/** Logical edge of a sprite and the texture resolution it is drawn at. */
const LOGICAL = 16
const RES = 2
const N = LOGICAL * RES

// --- colour and noise ----------------------------------------------------------------------------

type RGB = [number, number, number]

const parsed = new Map<string, RGB>()
function rgb(hex: string): RGB {
  let v = parsed.get(hex)
  if (!v) {
    const n = parseInt(hex.slice(1), 16)
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    parsed.set(hex, v)
  }
  return v
}

const toHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
const lighten = (c: string, t: number) => mix(c, '#ffffff', t)
const darken = (c: string, t: number) => mix(c, '#000000', t)

/** Pick from a ramp (dark to light) by t in 0..1. */
const at = (ramp: string[], t: number) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(t * ramp.length)))]

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

function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise, so textures get soft clumps instead of pure static. */
function vnoise(x: number, y: number, s: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash(x0, y0, s)
  const b = hash(x0 + 1, y0, s)
  const c = hash(x0, y0 + 1, s)
  const d = hash(x0 + 1, y0 + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// --- the pixel buffer ----------------------------------------------------------------------------

type Paint = string | ((x: number, y: number) => string | null)

class Pix {
  readonly d = new Uint8ClampedArray(N * N * 4)

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < N && y < N
  }

  get(x: number, y: number): string | null {
    if (!this.inside(x, y)) return null
    const i = (y * N + x) * 4
    return this.d[i + 3] === 0 ? null : toHex([this.d[i], this.d[i + 1], this.d[i + 2]])
  }

  has(x: number, y: number) {
    return this.inside(x, y) && this.d[(y * N + x) * 4 + 3] > 0
  }

  set(x: number, y: number, color: string) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (!this.inside(x, y)) return
    const [r, g, b] = rgb(color)
    const i = (y * N + x) * 4
    this.d[i] = r
    this.d[i + 1] = g
    this.d[i + 2] = b
    this.d[i + 3] = 255
  }

  /** Mix a colour over what is already there (or set it where nothing is). */
  blend(x: number, y: number, color: string, t: number) {
    const cur = this.get(Math.floor(x), Math.floor(y))
    this.set(x, y, cur ? mix(cur, color, t) : color)
  }

  private put(x: number, y: number, paint: Paint) {
    const c = typeof paint === 'string' ? paint : paint(x, y)
    if (c) this.set(x, y, c)
  }

  rect(x: number, y: number, w: number, h: number, paint: Paint) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.put(i, j, paint)
  }

  poly(pts: number[][], paint: Paint) {
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(N - 1, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(N - 1, Math.ceil(Math.max(...xs))); x++) {
        if (inPoly(x + 0.5, y + 0.5, pts)) this.put(x, y, paint)
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, paint: Paint) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) this.put(x, y, paint)
      }
    }
  }

  /** A thick polyline, drawn as stamped discs; `width(t)` is the radius along it (t in 0..1). */
  stroke(pts: number[][], width: number | ((t: number) => number), paint: Paint, dx = 0, dy = 0) {
    const steps = 60
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const [x, y] = along(pts, t)
      const r = typeof width === 'number' ? width : width(t)
      this.ellipse(x + dx, y + dy, Math.max(0.5, r), Math.max(0.5, r), paint)
    }
  }

  /** A stroke shaded like a round bar: a dark body with lighter cores toward the light. */
  bar(pts: number[][], width: number | ((t: number) => number), ramp: string[]) {
    const k = ramp.length
    for (let j = 0; j < k; j++) {
      const shrink = j * 0.85
      this.stroke(pts, typeof width === 'number' ? Math.max(0.6, width - shrink) : (t) => Math.max(0.6, width(t) - shrink), ramp[j], -j * 0.4, -j * 0.4)
    }
  }

  /** Dark outline around every opaque pixel, on the transparent side. */
  outline(color: string) {
    const hit: number[] = []
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (this.has(x, y)) continue
        if (this.has(x - 1, y) || this.has(x + 1, y) || this.has(x, y - 1) || this.has(x, y + 1)) hit.push(x, y)
      }
    }
    for (let i = 0; i < hit.length; i += 2) this.set(hit[i], hit[i + 1], color)
  }

  /** Light on the upper-left silhouette, shade on the lower-right, so flat shapes round off. */
  rim(up: number, down: number) {
    const snap = new Uint8ClampedArray(this.d)
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && snap[(y * N + x) * 4 + 3] > 0
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!solid(x, y)) continue
        const c = toHex([snap[(y * N + x) * 4], snap[(y * N + x) * 4 + 1], snap[(y * N + x) * 4 + 2]])
        if (!solid(x, y - 1) || !solid(x - 1, y)) this.set(x, y, lighten(c, up))
        else if (!solid(x, y + 1) || !solid(x + 1, y)) this.set(x, y, darken(c, down))
      }
    }
  }

  canvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = N
    canvas.height = N
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(N, N)
    img.data.set(this.d)
    ctx.putImageData(img, 0, 0)
    return canvas
  }
}

function inPoly(x: number, y: number, pts: number[][]) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A point along a polyline (2 points: a line; 3 points: a quadratic curve), t in 0..1. */
function along(pts: number[][], t: number): [number, number] {
  if (pts.length === 3) {
    const u = 1 - t
    return [u * u * pts[0][0] + 2 * u * t * pts[1][0] + t * t * pts[2][0], u * u * pts[0][1] + 2 * u * t * pts[1][1] + t * t * pts[2][1]]
  }
  return [pts[0][0] + (pts[1][0] - pts[0][0]) * t, pts[0][1] + (pts[1][1] - pts[0][1]) * t]
}

const pix = (draw: (p: Pix) => void) => {
  const p = new Pix()
  draw(p)
  return p.canvas()
}

/** A ball lit from the upper left; `extra` may repaint a pixel (iris, swirls). */
function sphere(
  p: Pix,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: string[],
  extra?: (x: number, y: number, nx: number, ny: number, color: string) => string | void,
) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      const d2 = nx * nx + ny * ny
      if (d2 > 1) continue
      const z = Math.sqrt(1 - d2)
      const l = Math.max(0, -0.42 * nx - 0.52 * ny + 0.74 * z)
      let c = at(ramp, Math.pow(l, 1.15))
      const over = extra?.(x, y, nx, ny, c)
      if (over) c = over
      p.set(x, y, c)
    }
  }
}

// --- blocks --------------------------------------------------------------------------------------

/**
 * A block face: clumpy noise over a dark-to-light tone list, a dark outer rim and a thin light/shade
 * pair inside it (light top left, shade bottom right), so neighbours read as separate cubes.
 */
function slab(p: Pix, tones: string[], rim: string, seed: number, clump = 3.2) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = vnoise(x / clump, y / clump, seed) * 0.62 + hash(x, y, seed + 7) * 0.38
      p.set(x, y, at(tones, n))
    }
  }
  frame(p, rim)
}

function frame(p: Pix, rim: string) {
  for (let i = 0; i < N; i++) {
    for (const [x, y] of [[i, 1], [1, i]]) {
      const c = p.get(x, y)
      if (c) p.set(x, y, lighten(c, 0.13))
    }
    for (const [x, y] of [[i, N - 2], [N - 2, i]]) {
      const c = p.get(x, y)
      if (c) p.set(x, y, darken(c, 0.2))
    }
  }
  for (let i = 0; i < N; i++) {
    p.set(i, 0, rim)
    p.set(i, N - 1, rim)
    p.set(0, i, rim)
    p.set(N - 1, i, rim)
  }
}

/** A hairline crack that wanders. */
function crack(p: Pix, x: number, y: number, len: number, color: string, r: () => number, dir = 1) {
  for (let i = 0; i < len; i++) {
    if (x < 3 || y < 3 || x > N - 4 || y > N - 4) return
    p.blend(x, y, color, 0.75)
    const step = r()
    if (step < 0.45) y += dir
    else if (step < 0.8) x += 1
    else x -= 1
  }
}

const STONE_TONES = ['#4d5057', '#585b63', '#63666e', '#6e717a', '#7a7d86']
const STONE_RIM = '#35373d'

/** One lump of ore set in the stone: a lit blob (or a faceted gem), a pit shadow and an outline. */
function nugget(p: Pix, cx: number, cy: number, r: number, ramp: string[], gem: boolean, ph: number) {
  const cells: [number, number, number][] = []
  const inCell = new Set<number>()
  for (let dy = -Math.ceil(r) - 1; dy <= Math.ceil(r) + 1; dy++) {
    for (let dx = -Math.ceil(r) - 1; dx <= Math.ceil(r) + 1; dx++) {
      const a = Math.atan2(dy, dx)
      const rr = r * (1 + 0.22 * Math.sin(a * 3 + ph))
      const inside = gem ? Math.abs(dx + 0.5) + Math.abs(dy + 0.5) <= rr * 1.25 : (dx + 0.5) ** 2 / rr ** 2 + (dy + 0.5) ** 2 / (rr * 0.88) ** 2 <= 1
      if (!inside) continue
      const l = 0.55 - (dx + dy) / (rr * 3.2)
      cells.push([cx + dx, cy + dy, l])
      inCell.add((cy + dy) * N + cx + dx)
    }
  }
  const has = (x: number, y: number) => inCell.has(y * N + x)
  // Pit shadow on the stone below and to the right, then the outline.
  for (const [x, y] of cells) {
    for (const [ox, oy] of [[1, 1], [1, 0], [0, 1]]) {
      if (!has(x + ox, y + oy)) {
        const c = p.get(x + ox, y + oy)
        if (c) p.set(x + ox, y + oy, darken(c, 0.42))
      }
    }
  }
  for (const [x, y, l] of cells) {
    const edge = !has(x - 1, y) || !has(x, y - 1) || !has(x + 1, y) || !has(x, y + 1)
    p.set(x, y, edge ? ramp[0] : at(ramp, Math.min(0.99, Math.max(0.12, l))))
  }
  // A bright glint on the lit side.
  const top = cells.reduce((best, c) => (c[0] + c[1] < best[0] + best[1] ? c : best), cells[0])
  p.set(top[0] + 1, top[1] + 1, ramp[ramp.length - 1])
}

function ore(seed: number, ramp: string[], count: number, gem = false) {
  return pix((p) => {
    const r = rng(seed)
    slab(p, STONE_TONES, STONE_RIM, seed)
    crack(p, 6 + Math.floor(r() * 18), 2, 7, '#3a3c42', r)
    crack(p, 4 + Math.floor(r() * 20), 24, 6, '#3a3c42', r, -1)
    const placed: [number, number][] = []
    let tries = 0
    while (placed.length < count && tries++ < 80) {
      const x = 5 + Math.floor(r() * 22)
      const y = 5 + Math.floor(r() * 22)
      if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 6)) continue
      placed.push([x, y])
      nugget(p, x, y, 2.1 + r() * 1.6, ramp, gem, r() * 6)
    }
    frame(p, STONE_RIM)
  })
}

// --- items ---------------------------------------------------------------------------------------

const WOOD = ['#3f2610', '#64401c', '#8a5c2b', '#b07c3e']
const STEEL = ['#656b76', '#8f96a1', '#bcc2cc', '#e9edf2']
const GOLD = ['#7d5a10', '#b8891c', '#e9b52b', '#ffe27a']

/** A faceted gem seen from the side: table, crown and pavilion, each facet one tone. */
function gem(ramp: string[]) {
  return pix((p) => {
    const body = [[10, 4], [22, 4], [29, 12], [16, 29], [3, 12]]
    p.poly(body, ramp[1])
    p.poly([[10, 4], [22, 4], [19, 12], [13, 12]], ramp[4])
    p.poly([[10, 4], [13, 12], [3, 12]], ramp[3])
    p.poly([[22, 4], [29, 12], [19, 12]], ramp[2])
    p.poly([[3, 12], [13, 12], [16, 29]], ramp[2])
    p.poly([[13, 12], [19, 12], [16, 29]], ramp[3])
    p.poly([[19, 12], [29, 12], [16, 29]], ramp[1])
    p.stroke([[3, 12], [29, 12]], 0.5, lighten(ramp[3], 0.25))
    // A cross of light on the table.
    const spark = lighten(ramp[4], 0.7)
    p.set(13, 6, spark)
    p.set(12, 6, spark)
    p.set(14, 6, spark)
    p.set(13, 5, spark)
    p.set(13, 7, spark)
    p.outline(darken(ramp[0], 0.35))
  })
}

/** A wing pair: ribbed membrane fanning from the shoulders, mirrored around the middle. */
function wingPair(ramp: string[], outline: number[][], ribs: number, shoulder: [number, number]) {
  return pix((p) => {
    const [sx, sy] = shoulder
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < 16; x++) {
        if (!inPoly(x + 0.5, y + 0.5, outline)) continue
        const theta = Math.atan2(y + 0.5 - sy, sx - (x + 0.5)) + Math.PI / 2
        const u = (theta / Math.PI) * ribs
        const frac = u - Math.floor(u)
        const sector = Math.floor(u)
        const dist = Math.hypot(x + 0.5 - sx, y + 0.5 - sy)
        let c = sector % 2 ? ramp[2] : ramp[3]
        if (dist > 14) c = sector % 2 ? ramp[1] : ramp[2]
        if (frac < 0.12 || frac > 0.9) c = ramp[1]
        if (dist < 4) c = ramp[1]
        p.set(x, y, c)
        p.set(N - 1 - x, y, c)
      }
    }
    p.rim(0.28, 0.25)
    p.outline(darken(ramp[0], 0.3))
  })
}

// --- builders ------------------------------------------------------------------------------------

const builders: Record<SpriteName, () => HTMLCanvasElement> = {
  coal: () => ore(11, ['#0b0b0d', '#1a1a1f', '#2c2c34', '#44444f', '#7a7a8a'], 7),
  iron: () => ore(23, ['#6e4f3f', '#9b7660', '#c49b83', '#e0c2ae', '#fbeee4'], 6),
  gold: () => ore(37, ['#7a4f0c', '#c28418', '#eab028', '#f9d94c', '#fffbc2'], 6),
  diamond: () => ore(41, ['#146e75', '#23a8a8', '#4fe3dc', '#9ff6f1', '#f0ffff'], 6, true),
  redstone: () => ore(53, ['#520909', '#8e1414', '#d92d2d', '#ff5d4c', '#ffc4b8'], 8),
  lapis: () => ore(67, ['#0f2260', '#1d3a8f', '#2f58cf', '#5a8af0', '#c4d8ff'], 7),
  emerald: () => ore(71, ['#0a4a26', '#16974a', '#2ed56a', '#7bf2a3', '#e2ffe9'], 6, true),

  gunpowder: () =>
    pix((p) => {
      const r = rng(83)
      slab(p, ['#1b1c21', '#23252b', '#2c2e35', '#363940'], '#101114', 83, 2.4)
      for (let i = 0; i < 46; i++) {
        const x = 3 + Math.floor(r() * 26)
        const y = 3 + Math.floor(r() * 26)
        const c = ['#6c6c74', '#8c8c94', '#adadb6', '#c8c8d0'][Math.floor(r() * 4)]
        p.set(x, y, c)
        if (r() < 0.45) p.set(x + 1, y, darken(c, 0.35))
        if (r() < 0.2) p.set(x, y + 1, darken(c, 0.5))
      }
      frame(p, '#101114')
    }),

  skull: () =>
    pix((p) => {
      const bone = ['#8d8873', '#b3ad95', '#d3cdb5', '#ece8d6', '#fbf9ee']
      // Jaw first, then the cranium over it.
      p.poly([[9, 19], [23, 19], [22, 28], [10, 28]], (x) => at(bone, 0.36 + (x < 14 ? 0.18 : x > 19 ? -0.1 : 0.06)))
      sphere(p, 16, 13, 11.5, 10, bone)
      const dark = '#16130d'
      p.ellipse(10.6, 15, 3.3, 3.6, dark)
      p.ellipse(21.4, 15, 3.3, 3.6, dark)
      for (const [x, y] of [[10, 16], [11, 16], [21, 16], [22, 16]]) p.set(x, y, '#d8452a')
      for (const [x, y] of [[10, 15], [21, 15]]) p.set(x, y, '#ffa24a')
      p.poly([[16, 18], [13.4, 22.5], [18.6, 22.5]], dark)
      // Teeth: a dark mouth line and the gaps between them.
      p.rect(11, 23, 10, 1, '#3d382a')
      for (const x of [13, 16, 19]) p.rect(x, 24, 1, 4, '#4a4534')
      p.rect(11, 27, 10, 1, '#8d8873')
      p.rim(0.12, 0.2)
      p.outline('#2a271c')
    }),

  creeper: () =>
    pix((p) => {
      slab(p, ['#2d6a26', '#3a7d30', '#4c9840', '#5aaa48', '#6dbd58'], '#1f4a1a', 97, 3.6)
      const dark = '#0c1007'
      p.rect(6, 8, 6, 6, dark)
      p.rect(20, 8, 6, 6, dark)
      p.rect(7, 9, 2, 2, '#1f2a14')
      p.rect(21, 9, 2, 2, '#1f2a14')
      p.rect(12, 14, 8, 6, dark)
      p.rect(10, 20, 4, 7, dark)
      p.rect(18, 20, 4, 7, dark)
      // The pits sit lower than the face: a light lip under them.
      for (const [x, w] of [[6, 6], [20, 6]]) p.rect(x, 14, w, 1, '#7fcf68')
      p.rect(12, 20, 8, 1, '#7fcf68')
      frame(p, '#1f4a1a')
    }),

  // Original portal: dark frame around a purple whirl.
  portal: () =>
    pix((p) => {
      slab(p, ['#150a26', '#1d0f33', '#26143f', '#2f1a4d'], '#0a0414', 131, 2.6)
      const whirl = ['#3a1280', '#5a1fb4', '#7a2fd6', '#9a52ee', '#c58bff', '#ecd2ff']
      p.rect(5, 5, 22, 22, '#0e0620')
      for (let y = 6; y < 26; y++) {
        for (let x = 6; x < 26; x++) {
          const dx = x + 0.5 - 16
          const dy = y + 0.5 - 16
          const d = Math.hypot(dx, dy)
          const v = Math.sin(Math.atan2(dy, dx) * 2 + d * 0.55) * 0.5 + 0.5
          const n = hash(x, y, 9) * 0.12
          p.set(x, y, at(whirl, Math.min(0.99, v * 0.62 + (1 - d / 14) * 0.38 + n)))
        }
      }
      for (const [x, y] of [[9, 9], [20, 11], [12, 21], [22, 22], [15, 14]]) {
        p.set(x, y, '#ffffff')
        p.set(x + 1, y, '#e6caff')
      }
      for (let i = 5; i < 27; i++) {
        p.blend(i, 5, '#000000', 0.45)
        p.blend(5, i, '#000000', 0.45)
      }
      frame(p, '#0a0414')
    }),

  pickaxe: () =>
    pix((p) => {
      // The handle runs up to the right under the head; a grip wrap sits near its foot.
      p.bar([[4, 28], [22, 10]], 1.75, WOOD)
      p.stroke([[6, 26], [9, 23]], 1.9, '#2f2a26')
      p.stroke([[7, 25.4], [8.4, 24]], 0.8, '#5c534b')
      // The head: a curved bar, thick in the middle and pointed at both tips.
      p.bar([[10, 4], [27, 5], [28, 22]], (t) => 0.9 + Math.sin(t * Math.PI) * 2.3, STEEL)
      p.rim(0.12, 0.2)
      p.outline('#1b1d22')
    }),

  dynamite: () =>
    pix((p) => {
      const red = ['#6e1212', '#a82222', '#d93a3a', '#f26a62']
      // Three sticks bundled with a band.
      for (const x0 of [3, 12, 21]) {
        p.rect(x0, 12, 8, 16, (x) => at(red, [0.5, 0.78, 0.78, 0.45, 0.45, 0.2, 0.2, 0.05][x - x0] ?? 0.1))
        p.ellipse(x0 + 4, 12, 4, 1.8, '#f08a7c')
        p.ellipse(x0 + 4, 12, 2.3, 0.9, '#fbc7bd')
      }
      p.rect(2, 17, 28, 6, (x, y) => (y === 17 ? '#fbf1d4' : y === 22 ? '#a89a72' : at(['#a89a72', '#d6c8a0', '#e8dcb8', '#f6edcf'], 0.35 + ((x % 9) < 4 ? 0.3 : 0.1))))
      for (const x0 of [6, 15, 24]) {
        p.rect(x0, 19, 2, 2, '#2a2622')
        p.set(x0 + 2, 19, '#2a2622')
      }
      p.rect(2, 17, 28, 1, '#fffaf0')
      // Fuse with a spark.
      p.stroke([[16, 12], [20, 5], [23, 3]], 0.9, '#3a2c20')
      p.stroke([[16, 12], [20, 5], [23, 3]], 0.45, '#8a6a44', -0.3, -0.3)
      p.ellipse(24, 3, 2.4, 2.4, '#ffb02e')
      p.ellipse(24, 3, 1.3, 1.3, '#fff0a0')
      for (const [x, y] of [[28, 1], [21, 1], [27, 6], [25, 0]]) p.set(x, y, '#ffd24a')
      p.rim(0.1, 0.22)
      p.outline('#2a1210')
    }),

  'crystal-red': () => gem(['#4f0a14', '#8e1a26', '#d83a46', '#ff6f78', '#ffd6d6']),
  'crystal-blue': () => gem(['#0e2466', '#1d46b4', '#4c82f0', '#8fb6ff', '#e0ecff']),

  elytra: () =>
    wingPair(
      ['#241f36', '#3d3560', '#5f5690', '#8a82bb'],
      [[15, 9], [10, 4], [4, 4], [1, 9], [1, 16], [3, 22], [7, 27], [12, 28], [15, 22]],
      5,
      [15, 10],
    ),

  stone: () => pix((p) => slab(p, ['#2a2d33', '#30333a', '#383b43', '#41444d'], '#1f2126', 5, 3.4)),
  cave: () =>
    pix((p) => {
      const r = rng(9)
      slab(p, ['#17191d', '#1d1f24', '#23252b', '#2a2d33'], '#101216', 9, 3.4)
      crack(p, 8, 2, 10, '#0c0d10', r)
      crack(p, 22, 3, 8, '#0c0d10', r)
      crack(p, 14, 29, 7, '#0c0d10', r, -1)
      frame(p, '#101216')
    }),

  // Врата Края
  chorus: () =>
    pix((p) => {
      const r = rng(151)
      slab(p, ['#5f3d73', '#6f4885', '#82599a', '#9470ab', '#a687bc'], '#3b2349', 151, 2.8)
      // Plant cells: pale rings around dark pits.
      for (const [cx, cy] of [[9, 9], [22, 11], [12, 22], [24, 24]]) {
        const ox = Math.floor(r() * 3) - 1
        const oy = Math.floor(r() * 3) - 1
        p.ellipse(cx + ox, cy + oy, 4, 4, '#caa4de')
        p.ellipse(cx + ox, cy + oy, 3, 3, '#a47bbd')
        p.ellipse(cx + ox + 0.5, cy + oy + 0.5, 1.6, 1.6, '#3b2349')
        p.set(cx + ox - 2, cy + oy - 3, '#f0daff')
      }
      frame(p, '#3b2349')
    }),

  endstone: () =>
    pix((p) => {
      const r = rng(163)
      slab(p, ['#c4c185', '#d0cd94', '#dcd9a3', '#e8e5b4', '#f3f1c8'], '#8a8756', 163, 3)
      for (let i = 0; i < 9; i++) {
        const x = 4 + Math.floor(r() * 22)
        const y = 4 + Math.floor(r() * 22)
        p.rect(x, y, 3, 2, '#a9a56a')
        p.rect(x, y + 2, 3, 1, '#f8f6d6')
        p.set(x + 3, y, '#d9d69b')
      }
      frame(p, '#8a8756')
    }),

  obsidian: () =>
    pix((p) => {
      const r = rng(173)
      slab(p, ['#0c0618', '#120a22', '#1a0f30', '#23143f'], '#06030d', 173, 3.4)
      // Glassy streaks running diagonally.
      for (let y = 2; y < 30; y++) {
        for (let x = 2; x < 30; x++) {
          const s = (x + y * 1.3) % 13
          if (s < 1.2 && hash(x, y, 4) > 0.22) p.blend(x, y, '#6a3fb0', 0.5)
          if (s >= 1.2 && s < 2.1 && hash(x, y, 5) > 0.7) p.blend(x, y, '#3b2178', 0.6)
        }
      }
      for (let i = 0; i < 6; i++) p.set(4 + Math.floor(r() * 24), 4 + Math.floor(r() * 24), '#b58cff')
      frame(p, '#06030d')
    }),

  pearl: () =>
    pix((p) => {
      sphere(p, 16, 16, 12, 12, ['#0a332b', '#126052', '#1b8a74', '#2fc2a2', '#6fe8c9'], (_x, _y, nx, ny, color) => {
        const swirl = Math.sin(Math.atan2(ny, nx) * 2 + Math.hypot(nx, ny) * 7)
        return swirl > 0.82 ? darken(color, 0.22) : undefined
      })
      p.ellipse(11.5, 9.5, 2.6, 1.8, '#e8fff9')
      p.ellipse(11, 9, 1.3, 0.9, '#ffffff')
      p.set(20, 22, '#7ff0d2')
      p.set(21, 21, '#7ff0d2')
      p.outline('#06241e')
    }),

  eye: () =>
    pix((p) => {
      const gold = ['#7a4e10', '#b9801c', '#e8ae36', '#ffd668']
      sphere(p, 16, 16, 12, 12, ['#0b2a16', '#17502d', '#2a7d44', '#45b265', '#8cf0a8'], (x, y) => {
        const dx = x + 0.5 - 16
        const dy = y + 0.5 - 17
        const d = Math.hypot(dx, dy)
        if (d > 6.8) return
        if ((dx / 2.1) ** 2 + (dy / 4.6) ** 2 <= 1) return '#140a1f'
        return at(gold, 1 - d / 7.2 + (-dx - dy) * 0.02)
      })
      p.ellipse(11.8, 10, 2.3, 1.6, '#e8fff0')
      p.ellipse(11.3, 9.5, 1.1, 0.8, '#ffffff')
      p.set(17, 15, '#5b3a86')
      p.outline('#07180e')
    }),

  shulker: () =>
    pix((p) => {
      const shell = ['#4a2a63', '#6c3f90', '#8e5eae', '#a572c4', '#c79be0']
      // Body below, face in the dark gap, lid above with a lit top.
      p.rect(4, 15, 24, 13, (x, y) => (y > 25 ? shell[0] : at(shell, 0.34 + (x < 9 ? 0.12 : x > 22 ? -0.14 : 0))))
      p.rect(6, 17, 20, 8, '#1a0f24')
      p.rect(6, 17, 20, 1, '#0d0714')
      for (const x0 of [9, 19]) {
        p.rect(x0, 19, 4, 5, '#f2e36b')
        p.rect(x0 + 1, 21, 2, 3, '#ffc93a')
        p.rect(x0 + 1, 21, 2, 2, '#2a1a05')
        p.set(x0, 19, '#fffbd0')
      }
      p.rect(4, 14, 24, 2, shell[0])
      p.rect(3, 8, 26, 7, (_x, y) => at(shell, y < 10 ? 0.9 : 0.62 - (y - 10) * 0.05))
      p.rect(3, 5, 26, 4, (_x, y) => at(shell, y === 5 ? 1 : 0.88))
      p.rect(5, 4, 22, 1, shell[4])
      for (const x of [9, 16, 23]) p.rect(x, 9, 1, 5, shell[1])
      p.rim(0.1, 0.2)
      p.outline('#2a1238')
    }),

  wings: () =>
    wingPair(
      ['#12414a', '#2b7f8a', '#4fc0c8', '#9be9ee'],
      [[15, 8], [11, 3], [5, 3], [1, 9], [1, 17], [3, 24], [6, 30], [9, 25], [11, 29], [14, 22], [15, 16]],
      6,
      [15, 9],
    ),

  head: () =>
    pix((p) => {
      const scale = ['#07040c', '#0e0816', '#171024', '#241a35', '#33264a']
      p.rect(5, 7, 22, 21, (x, y) => at(scale, 0.18 + vnoise(x / 3, y / 3, 181) * 0.5 + (y < 12 ? 0.12 : 0)))
      // Horns.
      for (const [x0, w] of [[2, 5], [25, 5]]) {
        p.rect(x0, 2, w, 9, (x, y) => at(['#6d6980', '#9b97ae', '#c8c5d6', '#e8e6f0'], 0.3 + (x - x0) / (w * 1.6) + (y > 8 ? -0.2 : 0.1)))
        p.rect(x0 + 1, 1, w - 2, 1, '#e8e6f0')
      }
      // Eyes glow.
      for (const x0 of [7, 20]) {
        p.rect(x0 - 1, 12, 7, 6, '#3a1d63')
        p.rect(x0, 13, 5, 4, '#d27bff')
        p.rect(x0, 13, 5, 1, '#f0c8ff')
        p.rect(x0 + 1, 13, 1, 1, '#ffffff')
        p.rect(x0 + 3, 15, 2, 2, '#7a3fc0')
      }
      // Nostrils and snout ridge.
      p.rect(13, 20, 2, 3, '#3b2178')
      p.rect(17, 20, 2, 3, '#3b2178')
      p.rect(15, 8, 2, 11, '#33264a')
      // Teeth.
      for (const x0 of [7, 12, 17, 22]) p.poly([[x0, 25], [x0 + 3, 25], [x0 + 1.5, 30]], '#ece8d6')
      p.rim(0.25, 0.3)
      p.outline('#030208')
    }),

  egg: () =>
    pix((p) => {
      const ramp = ['#07030d', '#0e0618', '#1a0c2c', '#2b1647']
      for (let y = 2; y < 30; y++) {
        const t = (y - 2) / 27
        const half = 11.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.98 + 0.01)), 0.78) * (0.72 + 0.4 * t)
        for (let x = Math.floor(16 - half); x < Math.ceil(16 + half); x++) {
          const nx = (x + 0.5 - 16) / Math.max(1, half)
          const ny = (y + 0.5 - 16) / 14
          const l = Math.max(0, 0.42 - nx * 0.42 - ny * 0.34 + 0.4 * Math.sqrt(Math.max(0, 1 - nx * nx)))
          let c = at(ramp, Math.min(0.99, l))
          const spot = vnoise(x / 2.4, y / 2.4, 191)
          if (spot > 0.66) c = mix(c, '#b86bff', 0.55 * Math.min(1, (spot - 0.66) * 6))
          p.set(x, y, c)
        }
      }
      p.ellipse(12, 9, 1.6, 2.6, '#d9b0ff')
      p.ellipse(11.6, 8.4, 0.9, 1.4, '#ffffff')
      p.rim(0.1, 0.25)
      p.outline('#4a2a80')
    }),

  crystal: () =>
    pix((p) => {
      const ramp = ['#5a1250', '#a02a8c', '#e04fc0', '#f59be0', '#ffe3f8']
      p.poly([[16, 2], [28, 16], [16, 30], [4, 16]], ramp[1])
      p.poly([[16, 2], [4, 16], [16, 16]], ramp[3])
      p.poly([[16, 2], [28, 16], [16, 16]], ramp[2])
      p.poly([[4, 16], [16, 30], [16, 16]], ramp[1])
      p.poly([[28, 16], [16, 30], [16, 16]], ramp[0])
      // Glowing core.
      p.ellipse(16, 16, 4.2, 4.2, '#ffc9f0')
      p.ellipse(16, 16, 2.6, 2.6, '#ffffff')
      for (const [x, y] of [[16, 10], [16, 22], [10, 16], [22, 16]]) p.set(x, y, '#ffe3f8')
      p.stroke([[16, 3], [16, 29]], 0.4, ramp[0])
      p.outline('#3a0a34')
    }),

  endwall: () =>
    pix((p) => {
      const r = rng(19)
      slab(p, ['#150e22', '#1b1329', '#20162f', '#281d3f'], '#0e0817', 19, 3.4)
      for (let i = 0; i < 5; i++) p.set(4 + Math.floor(r() * 24), 4 + Math.floor(r() * 24), '#5b3d96')
      frame(p, '#0e0817')
    }),

  // Бурение
  dirt: () =>
    pix((p) => {
      const r = rng(211)
      slab(p, ['#5f3a1d', '#704622', '#835329', '#965f33', '#a86e3d'], '#3a2210', 211, 2.8)
      for (let i = 0; i < 6; i++) {
        const x = 4 + Math.floor(r() * 22)
        const y = 4 + Math.floor(r() * 22)
        p.rect(x, y, 3, 2, '#7a7468')
        p.rect(x, y, 3, 1, '#a39d90')
        p.rect(x, y + 2, 3, 1, '#4a4639')
      }
      for (let i = 0; i < 14; i++) p.set(3 + Math.floor(r() * 26), 3 + Math.floor(r() * 26), r() < 0.5 ? '#bd8250' : '#4d2f17')
      frame(p, '#3a2210')
    }),

  chest: () =>
    pix((p) => {
      const planks = (x: number, y: number, top: number, bot: number) => {
        const t = Math.min(1, Math.max(0, (y - top) / (bot - top)))
        let c = at(WOOD, 0.95 - t * 0.55)
        if (x % 6 === 0) c = darken(c, 0.28)
        if (hash(x, y, 31) > 0.9) c = darken(c, 0.12)
        return c
      }
      // Body, then the barrel lid on top.
      p.rect(4, 14, 24, 14, (x, y) => planks(x, y, 14, 28))
      p.rect(5, 5, 22, 10, (x, y) => (y === 5 ? lighten(planks(x, y, 5, 14), 0.2) : planks(x, y, 5, 14)))
      p.rect(4, 7, 1, 7, WOOD[1])
      p.rect(27, 7, 1, 7, WOOD[1])
      p.rect(4, 13, 24, 2, '#24140a')
      // Iron-gold bands and the lock.
      for (const x0 of [7, 22]) {
        p.rect(x0, 5, 3, 23, (x, y) => at(GOLD, y < 14 ? 0.82 - (x - x0) * 0.28 : 0.7 - (x - x0) * 0.28))
        p.rect(x0, 13, 3, 2, '#3b2a08')
      }
      p.rect(13, 11, 6, 8, (x, y) => at(GOLD, 0.9 - (y - 11) * 0.06 - (x - 13) * 0.04))
      p.rect(13, 11, 6, 1, '#fff2a8')
      p.rect(15, 14, 2, 2, '#2a1c06')
      p.rect(15, 16, 1, 2, '#2a1c06')
      p.rect(4, 27, 24, 1, '#24140a')
      p.rim(0.1, 0.2)
      p.outline('#1f1209')
    }),

  chestopen: () =>
    pix((p) => {
      // The lid, thrown back: its dark underside and the lit top edge.
      p.rect(5, 1, 22, 8, (_x, y) => (y < 3 ? lighten(WOOD[3], 0.1) : at(['#1f1209', '#2f1c0d', '#3d2610'], 0.3 + (y - 3) * 0.1)))
      for (const x0 of [7, 22]) p.rect(x0, 1, 3, 8, (x) => at(GOLD, 0.6 - (x - x0) * 0.2))
      // The cavity with a pile of coins in it.
      p.rect(5, 9, 22, 7, '#160d06')
      const pile: [number, number, number][] = [[9, 12, 3], [14, 11, 3.2], [19, 11.5, 3], [23, 12.5, 2.6], [12, 14, 2.6], [17, 14, 2.8], [21, 14.5, 2.4]]
      for (const [cx, cy, r] of pile) {
        p.ellipse(cx, cy, r, r * 0.85, GOLD[1])
        p.ellipse(cx - 0.3, cy - 0.3, r * 0.8, r * 0.7, GOLD[2])
        p.ellipse(cx - 0.8, cy - 0.8, r * 0.4, r * 0.35, GOLD[3])
        p.set(cx, cy, GOLD[0])
      }
      for (const [x, y] of [[8, 8], [16, 6], [23, 9], [12, 10], [26, 12]]) {
        p.set(x, y, '#fffbd0')
        p.set(x + 1, y, '#fff0a0')
        p.set(x, y - 1, '#fff0a0')
      }
      // The front of the chest.
      p.rect(4, 16, 24, 12, (x, y) => {
        const t = (y - 16) / 12
        let c = at(WOOD, 0.9 - t * 0.5)
        if (x % 6 === 0) c = darken(c, 0.28)
        return c
      })
      p.rect(4, 15, 24, 2, '#24140a')
      p.rect(4, 15, 24, 1, WOOD[3])
      for (const x0 of [7, 22]) p.rect(x0, 15, 3, 13, (x) => at(GOLD, 0.75 - (x - x0) * 0.25))
      p.rect(13, 16, 6, 5, GOLD[2])
      p.rect(13, 16, 6, 1, '#fff2a8')
      p.rect(15, 18, 2, 2, '#2a1c06')
      p.rect(4, 27, 24, 1, '#24140a')
      p.rim(0.1, 0.2)
      p.outline('#1f1209')
    }),

  // The bit points down: it bores toward the chests.
  drill: () =>
    pix((p) => {
      const yellow = ['#7a5410', '#b58216', '#e9b52b', '#ffd95a']
      // Bit: a cone with spiral threads, lit from the left.
      p.poly([[7, 14], [25, 14], [16, 30]], (x, y) => {
        const half = (30 - y) * 0.5625
        const nx = Math.max(-1, Math.min(1, (x + 0.5 - 16) / Math.max(1, half)))
        const band = ((y + nx * 3 + 40) % 5) < 2.4
        const base = at(STEEL, 0.78 - (nx + 1) * 0.36)
        return band ? darken(base, 0.22) : base
      })
      p.set(16, 29, '#f4f6fa')
      // Collar.
      p.rect(6, 11, 20, 4, (x, y) => at(STEEL, 0.5 - (x - 6) * 0.025 - (y - 11) * 0.05))
      p.rect(6, 11, 20, 1, '#f4f6fa')
      // Motor housing.
      p.rect(7, 2, 18, 10, (x, y) => (y >= 6 && y <= 7 ? (x % 4 < 2 ? '#2a2622' : '#e9b52b') : at(yellow, 0.95 - (x - 7) * 0.044)))
      p.rect(7, 2, 18, 1, '#fff0a0')
      p.rect(10, 9, 12, 1, '#5c3f08')
      for (const x of [10, 14, 18, 22]) p.rect(x, 4, 1, 2, '#5c3f08')
      p.rim(0.1, 0.22)
      p.outline('#1b1d22')
    }),
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

/** The sprite as a texture whose logical size is 16x16 (its canvas is drawn at twice that). */
export function textureOf(name: SpriteName): Texture {
  let tex = textures.get(name)
  if (!tex) {
    tex = new Texture({ source: new CanvasSource({ resource: canvasOf(name), resolution: RES, scaleMode: 'nearest' }) })
    textures.set(name, tex)
  }
  return tex
}

const urls = new Map<string, string>()
/** A crisp upscaled data URL for plain DOM use (lobby art, paytable); `scale` counts logical pixels. */
export function dataUrl(name: SpriteName, scale = 4): string {
  const key = `${name}@${scale}`
  let url = urls.get(key)
  if (!url) {
    const src = canvasOf(name)
    const big = document.createElement('canvas')
    big.width = (src.width / RES) * scale
    big.height = (src.height / RES) * scale
    const ctx = big.getContext('2d')!
    ctx.imageSmoothingEnabled = scale / RES < 1
    ctx.drawImage(src, 0, 0, big.width, big.height)
    url = big.toDataURL()
    urls.set(key, url)
  }
  return url
}
