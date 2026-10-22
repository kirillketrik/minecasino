import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { reducedMotion } from '../format.ts'
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

const SPRITE: Record<string, SpriteName> = {
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
}

export const isCreeper = (cell: string) => cell.startsWith('creeper')
export const creeperValue = (cell: string) => Number(cell.split(':')[1])

function makeCell(cell: string): Container {
  const box = new Container()
  const name = SPRITE[isCreeper(cell) ? 'creeper' : cell] ?? 'coal'
  const s = new Sprite(textureOf(name))
  s.scale.set(SCALE)
  box.addChild(s)
  if (isCreeper(cell)) {
    const label = new Text({
      text: `×${creeperValue(cell)}`,
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

  constructor(app: Application, world: Container) {
    this.app = app
    const wall = new TilingSprite({ texture: textureOf('cave'), width: CREEPER_W, height: CREEPER_H })
    wall.tileScale.set(SCALE / 1.5)
    world.addChild(wall)
    this.tint.rect(0, 0, CREEPER_W, CREEPER_H).fill({ color: 0x5b2a86, alpha: 0.32 })
    this.tint.visible = false
    world.addChild(this.tint)
    const frame = new Graphics()
      .rect(OX - 10, OY - 10, COLS * PITCH - GAP + 20, ROWS * PITCH - GAP + 20)
      .fill(0x101216)
    world.addChild(frame)
    const wells = new Graphics()
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) wells.rect(OX + c * PITCH, OY + r * PITCH, CELL, CELL).fill(0x1b1e25)
    world.addChild(wells, this.layer, this.marks, this.fx)
    const idle = ['gunpowder', 'redstone', 'lapis', 'iron', 'gold', 'emerald']
    this.setGrid(Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => idle[(c + r) % idle.length])))
  }

  destroy() {
    this.alive = false
  }

  setGrid(grid: string[][]) {
    this.kinds = grid.map((col) => [...col])
    this.layer.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.cells = grid.map((col, c) =>
      col.map((cell, r) => {
        const box = makeCell(cell)
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
  }

  private mark(cells: [number, number][], color = 0xf5bd45) {
    this.marks.clear()
    const lit = new Set(cells.map(([c, r]) => `${c}:${r}`))
    this.cells.forEach((col, c) => col.forEach((box, r) => box && (box.alpha = lit.has(`${c}:${r}`) ? 1 : 0.38)))
    for (const [c, r] of cells) {
      this.marks.rect(OX + c * PITCH - 3, OY + r * PITCH - 3, CELL + 6, CELL + 6).stroke({ width: 4, color })
    }
  }

  /** Free spins are played on a purple-tinted wall. */
  setFree(on: boolean) {
    this.tint.visible = on
  }

  /** Light up the creepers that landed, when their sum multiplies the total. */
  flashCreepers() {
    return this.pulse((cell) => isCreeper(cell), 0x7bf2a3)
  }

  /** Light up the portals that start or extend the free spins. */
  flashScatters() {
    return this.pulse((cell) => cell === 'scatter', 0xc07cff)
  }

  private async pulse(test: (cell: string) => boolean, color: number) {
    const hits: [number, number][] = []
    this.cells.forEach((col, c) => col.forEach((_, r) => test(this.kinds[c]?.[r] ?? '') && hits.push([c, r])))
    if (!hits.length) return
    this.mark(hits, color)
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
  async playWave(wave: Wave, next: string[][]) {
    const winners = new Set<string>()
    for (const cl of wave.clusters) for (const [c, r] of cl.cells) winners.add(`${c}:${r}`)
    this.mark([...winners].map((k) => k.split(':').map(Number) as [number, number]))
    await wait(560)
    if (!this.alive) return

    // Explode: swell, then vanish with a burst of fragments.
    const burst = Array.from(winners).map((k) => k.split(':').map(Number) as [number, number])
    const fragments: { g: Graphics; vx: number; vy: number }[] = []
    if (!reducedMotion()) {
      for (const [c, r] of burst) {
        for (let i = 0; i < 6; i++) {
          const g = new Graphics().rect(-4, -4, 8, 8).fill([0xf5bd45, 0xe9ecf1, 0x8a93a3][i % 3])
          g.position.set(cx(c), cy(r))
          this.fx.addChild(g)
          const a = (Math.PI * 2 * i) / 6 + c + r
          fragments.push({ g, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 20 })
        }
      }
    }
    this.marks.clear()
    await tween(this.app, 380, (t) => {
      for (const k of winners) {
        const [c, r] = k.split(':').map(Number)
        const box = this.cells[c][r]
        if (!box) continue
        box.scale.set(t < 0.3 ? 1 + t * 0.5 : 1.15 * (1 - (t - 0.3) / 0.7))
        box.alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7
      }
      fragments.forEach((f, i) => {
        f.g.x += f.vx * 0.016
        f.g.y += f.vy * 0.016 + t * 2
        f.g.alpha = 1 - t
        f.g.rotation = t * (i % 2 ? 3 : -3)
      })
    }, easeOut)
    this.fx.removeChildren().forEach((g) => g.destroy())

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
        const box = makeCell(next[c][k])
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
