import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { reducedMotion } from '../format.ts'
import { bonusIntro } from './bonusFx.ts'
import { Fx, bevel, glow, shadow } from './fx.ts'
import type { BonusIntro } from './bonusFx.ts'
import { textureOf } from './sprites.ts'
import type { SpriteName } from './sprites.ts'
import { easeInOut, easeOut, easeOutBack, tween, wait } from './stage.tsx'

export const COLS = 6
export const ROWS = 5
const CELL = 76
const GAP = 6
const PITCH = CELL + GAP
const SCALE = CELL / 16
export const CREEPER_W = 560
export const CREEPER_H = 440
const OX = (CREEPER_W - (COLS * PITCH - GAP)) / 2
const OY = (CREEPER_H - (ROWS * PITCH - GAP)) / 2

export type Cluster = { symbol: string; count: number; units: number; cells: [number, number][]; win: number }
export type Wave = { multiplier: number; grid: string[][]; clusters: Cluster[]; win: number }

/** How one cluster slot looks: its symbols, its multiplier piece, its wall and its bonus. */
export type Skin = {
  sprites: Record<string, SpriteName>
  /** The piece that carries a multiplier, drawn as `${multiplier}:${value}` (Крипер, Яйцо). */
  multiplier: string
  scatter: string
  wall: SpriteName
  tint: number
  idle: string[]
  bonusIcon: SpriteName
  bonusColor: number
  flashColor: number
  /** Fragment colours of a vanishing block. */
  debris: number[]
  /** `blast`: the blocks hiss, swell and burst. `implode`: they spiral into the middle of the cluster. */
  vanish: 'blast' | 'implode'
  ambient: number[]
  /** Screen shake of the first wave, growing with every further one. */
  shake: number
  /** Colour of the shock ring and flash of a vanishing cluster. */
  blast: number
}

export const CREEPER_SKIN: Skin = {
  sprites: {
    gunpowder: 'gunpowder',
    redstone: 'redstone',
    lapis: 'lapis',
    iron: 'iron',
    gold: 'gold',
    emerald: 'emerald',
    diamond: 'diamond',
    skull: 'skull',
    creeper: 'creeper',
    scatter: 'portal',
  },
  multiplier: 'creeper',
  scatter: 'scatter',
  wall: 'cave',
  tint: 0x5b2a86,
  idle: ['gunpowder', 'redstone', 'lapis', 'iron', 'gold', 'emerald'],
  bonusIcon: 'portal',
  bonusColor: 0xc07cff,
  flashColor: 0x7bf2a3,
  debris: [0x7bf2a3, 0x2ed56a, 0x16974a, 0xe9ecf1],
  vanish: 'blast',
  ambient: [0x3a6b3a, 0x2a4a2a, 0x7bf2a3],
  shake: 3,
  blast: 0x7bf2a3,
}

export const ENDER_SKIN: Skin = {
  sprites: {
    chorus: 'chorus',
    endstone: 'endstone',
    obsidian: 'obsidian',
    pearl: 'pearl',
    eye: 'eye',
    shulker: 'shulker',
    wings: 'wings',
    head: 'head',
    egg: 'egg',
    scatter: 'crystal',
  },
  multiplier: 'egg',
  scatter: 'scatter',
  wall: 'endwall',
  tint: 0xa0245f,
  idle: ['chorus', 'endstone', 'obsidian', 'pearl', 'eye', 'shulker'],
  bonusIcon: 'crystal',
  bonusColor: 0xf06ad0,
  flashColor: 0xb86bff,
  debris: [0xf06ad0, 0xb86bff, 0x6a3fb0, 0xe3e0a8],
  vanish: 'implode',
  ambient: [0xb86bff, 0xf06ad0, 0x6a3fb0, 0xe3e0a8],
  shake: 1.5,
  blast: 0xb86bff,
}

export const cellValue = (cell: string) => Number(cell.split(':')[1])

function makeCell(cell: string, skin: Skin): Container {
  const box = new Container()
  const isMult = cell.startsWith(skin.multiplier)
  const name = skin.sprites[isMult ? skin.multiplier : cell] ?? 'coal'
  const s = new Sprite(textureOf(name))
  s.scale.set(SCALE)
  box.addChild(s)
  box.addChild(bevel(CELL))
  if (isMult) {
    const label = new Text({
      text: `×${cellValue(cell)}`,
      style: { fontFamily: 'Press Start 2P', fontSize: 15, fill: 0xffffff, stroke: { color: 0x10210c, width: 5 } },
    })
    label.anchor.set(1, 1)
    label.position.set(CELL - 5, CELL - 4)
    box.addChild(label)
  }
  box.pivot.set(CELL / 2)
  return box
}

const cx = (c: number) => OX + c * PITCH + CELL / 2
const cy = (r: number) => OY + r * PITCH + CELL / 2

export class CreeperScene {
  private cells: (Container | null)[][] = []
  private layer = new Container()
  private fx = new Container()
  private marks = new Graphics()
  private tint = new Graphics()
  private alive = true

  private app: Application
  private skin: Skin
  private depth: Fx

  constructor(app: Application, world: Container, skin: Skin = CREEPER_SKIN) {
    this.app = app
    this.skin = skin
    this.depth = new Fx(app, world, CREEPER_W, CREEPER_H)
    const wall = new TilingSprite({ texture: textureOf(skin.wall), width: CREEPER_W + 40, height: CREEPER_H + 30 })
    wall.position.set(-20, -15)
    wall.tileScale.set(SCALE / 1.5)
    this.depth.back.addChild(wall)
    this.depth.ambient(skin.ambient, 18, 18, 14)
    this.tint.rect(0, 0, CREEPER_W, CREEPER_H).fill({ color: skin.tint, alpha: 0.32 })
    this.tint.visible = false
    const front = this.depth.front
    front.addChild(this.tint)
    const frame = new Graphics()
      .rect(OX - 10, OY - 10, COLS * PITCH - GAP + 20, ROWS * PITCH - GAP + 20)
      .fill(0x101216)
    const rim = glow(CREEPER_W / 2, CREEPER_H / 2, 250, skin.bonusColor, 5, 0.035)
    const floor = shadow(COLS * PITCH, 0.5)
    floor.position.set(CREEPER_W / 2, OY + ROWS * PITCH + 10)
    front.addChild(rim, floor, frame)
    const wells = new Graphics()
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) wells.rect(OX + c * PITCH, OY + r * PITCH, CELL, CELL).fill(0x1b1e25)
    front.addChild(wells, this.layer, this.marks, this.fx)
    this.depth.raise()
    const idle = skin.idle
    this.setGrid(Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => idle[(c + r) % idle.length])))
  }

  destroy() {
    this.alive = false
    this.depth.destroy()
  }

  setGrid(grid: string[][]) {
    this.kinds = grid.map((col) => [...col])
    this.layer.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.cells = grid.map((col, c) =>
      col.map((cell, r) => {
        const box = makeCell(cell, this.skin)
        box.position.set(cx(c), cy(r))
        this.layer.addChild(box)
        return box
      }),
    )
    this.clearMarks()
  }

  clearMarks() {
    this.marks.clear()
    this.cells.forEach((col) => col.forEach((c) => c && (c.alpha = 1)))
  }

  /** The first deal: columns drop in from above, left to right. */
  async dropIn(grid: string[][]) {
    this.setGrid(grid)
    if (reducedMotion()) return
    const jobs: Promise<void>[] = []
    this.cells.forEach((col, c) =>
      col.forEach((box, r) => {
        const target = cy(r)
        box!.y = -CELL
        jobs.push(
          wait(c * 70 + (ROWS - r) * 25).then(() =>
            this.alive ? tween(this.app, 480, (t) => (box!.y = -CELL + (target + CELL) * t), easeOutBack) : undefined,
          ),
        )
      }),
    )
    await Promise.all(jobs)
    this.depth.shake(2, 200)
  }

  private mark(cells: [number, number][], color = 0xf5bd45) {
    this.marks.clear()
    const lit = new Set(cells.map(([c, r]) => `${c}:${r}`))
    this.cells.forEach((col, c) => col.forEach((box, r) => box && (box.alpha = lit.has(`${c}:${r}`) ? 1 : 0.38)))
    for (const [c, r] of cells) {
      this.marks.rect(OX + c * PITCH - 3, OY + r * PITCH - 3, CELL + 6, CELL + 6).stroke({ width: 4, color })
    }
  }

  /** Full-field announcement of a won bonus. */
  bonus(opts: Pick<BonusIntro, 'title' | 'sub'>) {
    return bonusIntro(this.app, this.fx, CREEPER_W, CREEPER_H, { icon: this.skin.bonusIcon, color: this.skin.bonusColor, ...opts })
  }

  /** Free spins are played on a tinted wall. */
  setFree(on: boolean) {
    this.tint.visible = on
  }

  /** Light up the multiplier pieces that landed, when their sum multiplies the total. */
  flashMultipliers() {
    return this.pulse((cell) => cell.startsWith(this.skin.multiplier), this.skin.flashColor)
  }

  /** Light up the portals that start or extend the free spins. */
  flashScatters() {
    return this.pulse((cell) => cell === this.skin.scatter, this.skin.bonusColor)
  }

  private async pulse(test: (cell: string) => boolean, color: number) {
    const hits: [number, number][] = []
    this.cells.forEach((col, c) => col.forEach((_, r) => test(this.kinds[c]?.[r] ?? '') && hits.push([c, r])))
    if (!hits.length) return
    this.mark(hits, color)
    for (const [c, r] of hits) this.depth.burst(cx(c), cy(r), { colors: [color, 0xffffff], count: 6, speed: 90, gravity: -60, life: 0.7, size: 4 })
    this.depth.ring(this.centre(hits).x, this.centre(hits).y, color, 90)
    if (!reducedMotion()) {
      await tween(this.app, 420, (t) => {
        const k = 1 + Math.sin(t * Math.PI) * 0.18
        for (const [c, r] of hits) this.cells[c][r]?.scale.set(k)
      }, easeInOut)
    } else await wait(200)
    this.clearMarks()
  }

  private kinds: string[][] = []

  /** Record what each cell is, so creepers can be found again after the grid moves. */
  remember(grid: string[][]) {
    this.kinds = grid.map((col) => [...col])
  }

  /** Explode one wave's clusters, let the rest fall and refill to `next`. */
  async playWave(wave: Wave, next: string[][], waveIndex = 0) {
    const winners = new Set<string>()
    for (const cl of wave.clusters) for (const [c, r] of cl.cells) winners.add(`${c}:${r}`)
    this.mark([...winners].map((k) => k.split(':').map(Number) as [number, number]))
    await wait(560)
    if (!this.alive) return

    const burst = Array.from(winners).map((k) => k.split(':').map(Number) as [number, number])
    this.marks.clear()
    await (this.skin.vanish === 'implode' ? this.implode(burst, waveIndex) : this.blast(burst, waveIndex))

    // Collapse: survivors fall to the bottom of their column, fresh cells drop in on top.
    const moves: Promise<void>[] = []
    const rebuilt: (Container | null)[][] = []
    let consistent = true
    for (let c = 0; c < COLS; c++) {
      const survivors: Container[] = []
      for (let r = 0; r < ROWS; r++) {
        const box = this.cells[c][r]
        if (box && winners.has(`${c}:${r}`)) {
          this.layer.removeChild(box)
          box.destroy({ children: true })
        } else if (box) survivors.push(box)
      }
      const fresh = ROWS - survivors.length
      const col: Container[] = []
      for (let k = 0; k < fresh; k++) {
        const box = makeCell(next[c][k], this.skin)
        box.position.set(cx(c), cy(-(fresh - k)))
        this.layer.addChild(box)
        col.push(box)
      }
      col.push(...survivors)
      rebuilt.push(col)
      col.forEach((box, r) => {
        const fromY = box.y
        const toY = cy(r)
        if (r >= fresh && wave.grid[c] && !this.sameCell(c, r, fresh, next, wave)) consistent = false
        moves.push(
          wait(c * 40).then(() =>
            fromY === toY || !this.alive ? undefined : tween(this.app, 420, (t) => (box.y = fromY + (toY - fromY) * t), easeOutBack),
          ),
        )
      })
    }
    await Promise.all(moves)
    this.cells = rebuilt
    this.kinds = next.map((col) => [...col])
    if (!consistent) this.setGrid(next)
  }

  /** Centre of a set of cells, in scene pixels. */
  private centre(cells: [number, number][]) {
    const x = cells.reduce((sum, [c]) => sum + cx(c), 0) / cells.length
    const y = cells.reduce((sum, [, r]) => sum + cy(r), 0) / cells.length
    return { x, y }
  }

  /** Крипер: the blocks hiss (shake and flash white), swell, then burst with a shock ring and debris. */
  private async blast(cells: [number, number][], wave: number) {
    const boxes = cells.map(([c, r]) => this.cells[c][r])
    await tween(this.app, 420, (t) => {
      const swell = 1 + t * 0.16
      boxes.forEach((box, i) => {
        if (!box) return
        box.scale.set(swell)
        box.rotation = Math.sin(t * 38 + i) * 0.045 * t
        const lit = Math.floor(t * 7) % 2 === 0 && t > 0.35
        box.children.forEach((ch) => ch instanceof Sprite && (ch.tint = lit ? 0xffffff : 0xdfffe0))
      })
    }, easeInOut)
    const at = this.centre(cells)
    this.depth.flash(this.skin.blast, 0.28, 220)
    this.depth.shake(this.skin.shake + wave * 1.6, 380)
    this.depth.ring(at.x, at.y, this.skin.blast, 150 + cells.length * 4)
    for (const [c, r] of cells) this.depth.burst(cx(c), cy(r), { colors: this.skin.debris, count: 7, speed: 190, gravity: 520, life: 0.8 })
    await tween(this.app, 260, (t) => {
      boxes.forEach((box) => {
        if (!box) return
        box.scale.set(1.16 * (1 - t) + 0.001)
        box.alpha = 1 - t
      })
    }, easeOut)
  }

  /** Врата Края: the blocks come loose, spiral into the middle of the cluster and are gone in a flash. */
  private async implode(cells: [number, number][], wave: number) {
    const boxes = cells.map(([c, r]) => this.cells[c][r])
    const at = this.centre(cells)
    const from = boxes.map((b) => (b ? { x: b.x, y: b.y } : { x: 0, y: 0 }))
    this.depth.flash(this.skin.blast, 0.16, 360)
    await tween(this.app, 620, (t) => {
      const swirl = t * t * 2.4
      boxes.forEach((box, i) => {
        if (!box) return
        const dx = from[i].x - at.x
        const dy = from[i].y - at.y
        const k = 1 - t
        const cos = Math.cos(swirl)
        const sin = Math.sin(swirl)
        box.x = at.x + (dx * cos - dy * sin) * k
        box.y = at.y + (dx * sin + dy * cos) * k
        box.rotation = swirl * 1.5
        box.scale.set(Math.max(0.02, 1 - t * 0.92))
        box.alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25
      })
    }, easeInOut)
    this.depth.ring(at.x, at.y, this.skin.blast, 110 + cells.length * 3)
    this.depth.shake(this.skin.shake + wave, 240)
    this.depth.burst(at.x, at.y, { colors: this.skin.debris, count: 10 + cells.length, speed: 150, gravity: -40, life: 0.9, size: 4 })
  }

  // Survivors are the cells that were not exploded, in order: they must equal the lower part of `next`.
  private sameCell(c: number, r: number, fresh: number, next: string[][], wave: Wave) {
    const kept: string[] = []
    const gone = new Set<number>()
    for (const cl of wave.clusters) for (const [cc, rr] of cl.cells) if (cc === c) gone.add(rr)
    wave.grid[c].forEach((cell, row) => {
      if (!gone.has(row)) kept.push(cell)
    })
    return kept[r - fresh] === next[c][r]
  }
}
