import { BlurFilter, Container, Graphics, Sprite, TilingSprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { reducedMotion } from '../format.ts'
import { bonusIntro } from './bonusFx.ts'
import type { BonusIntro } from './bonusFx.ts'
import { Fx, bevel, glow, shadow } from './fx.ts'
import { textureOf } from './sprites.ts'
import type { SpriteName } from './sprites.ts'
import { easeOutBack, tween, wait } from './stage.tsx'

export const REELS = 5
export const ROWS = 3
const CELL = 96
const GAP = 8
const PITCH = CELL + GAP
const SCALE = CELL / 16
export const MINES_W = 640
export const MINES_H = 400
const ORIGIN_X = (MINES_W - (REELS * PITCH - GAP)) / 2
const ORIGIN_Y = (MINES_H - (ROWS * PITCH - GAP)) / 2

/** Row each of the 20 lines takes on every reel; mirrors LINES in backend games/mines.py. */
export const LINES: number[][] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [1, 2, 2, 2, 1], [1, 0, 0, 0, 1], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
]

export const SYMBOL_SPRITE: Record<string, SpriteName> = {
  coal: 'coal',
  iron: 'iron',
  gold: 'gold',
  diamond: 'diamond',
  pickaxe: 'pickaxe',
  dynamite: 'dynamite',
}
const FILLERS = ['coal', 'iron', 'gold', 'diamond', 'pickaxe', 'dynamite', 'coal', 'iron']

export type Win = { line: number; symbol: string; count: number; win: number }

/** Cells [reel, row] covered by the winning runs of a set of line wins. */
export function winCells(wins: Win[]): [number, number][] {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const w of wins) {
    LINES[w.line - 1].slice(0, w.count).forEach((row, reel) => {
      const key = `${reel}:${row}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push([reel, row])
      }
    })
  }
  return out
}

function cellSprite(symbol: string): Container {
  const box = new Container()
  const s = new Sprite(textureOf(SYMBOL_SPRITE[symbol] ?? 'coal'))
  s.scale.set(SCALE)
  box.addChild(s, bevel(CELL))
  return box
}

export class MinesScene {
  private reels: Container[] = []
  private current: string[][] = []
  private marks = new Graphics()
  private fx = new Container()
  private alive = true

  private app: Application
  private depth: Fx
  private torches: Graphics[] = []
  private clock = 0

  constructor(app: Application, world: Container) {
    this.app = app
    this.depth = new Fx(app, world, MINES_W, MINES_H)
    const wall = new TilingSprite({ texture: textureOf('cave'), width: MINES_W + 40, height: MINES_H + 30 })
    wall.position.set(-20, -15)
    wall.tileScale.set(SCALE / 1.5)
    this.depth.back.addChild(wall)
    // Two torches on the shaft walls light the reels with a warm, flickering glow.
    for (const x of [18, MINES_W - 18]) {
      const lamp = glow(x, MINES_H / 2, 230, 0xf59a2e, 7, 0.045)
      this.depth.back.addChild(lamp)
      this.torches.push(lamp)
    }
    this.depth.ambient([0xf5bd45, 0xf59a2e, 0xffe08a], 16, 10, 12)
    app.ticker.add(this.flicker)
    world = this.depth.front
    const floor = shadow(REELS * PITCH, 0.5)
    floor.position.set(MINES_W / 2, ORIGIN_Y + ROWS * PITCH + 4)
    world.addChild(floor)

    const frame = new Graphics()
      .rect(ORIGIN_X - 10, ORIGIN_Y - 10, REELS * PITCH - GAP + 20, ROWS * PITCH - GAP + 20)
      .fill(0x101216)
    world.addChild(frame)

    for (let r = 0; r < REELS; r++) {
      const slot = new Graphics()
      for (let row = 0; row < ROWS; row++) {
        slot.rect(ORIGIN_X + r * PITCH, ORIGIN_Y + row * PITCH, CELL, CELL).fill(0x1b1e25)
      }
      world.addChild(slot)

      const reel = new Container()
      reel.x = ORIGIN_X + r * PITCH
      reel.y = ORIGIN_Y
      const mask = new Graphics().rect(reel.x, ORIGIN_Y, CELL, ROWS * PITCH - GAP).fill(0xffffff)
      world.addChild(mask)
      reel.mask = mask
      world.addChild(reel)
      this.reels.push(reel)
    }
    world.addChild(this.marks, this.fx)
    this.depth.raise()
    const idle = Array.from({ length: REELS }, (_, r) =>
      Array.from({ length: ROWS }, (_, row) => FILLERS[(r * 3 + row) % FILLERS.length]),
    )
    this.setGrid(idle)
  }

  private flicker = () => {
    if (!this.alive || reducedMotion()) return
    this.clock += this.app.ticker.deltaMS / 1000
    this.torches.forEach((lamp, i) => {
      lamp.alpha = 0.8 + 0.2 * Math.sin(this.clock * 7.3 + i * 2) * Math.sin(this.clock * 3.1 + i)
    })
  }

  destroy() {
    this.alive = false
    this.app.ticker?.remove(this.flicker)
    this.depth.destroy()
  }

  /** Full-field announcement of a won bonus. */
  bonus(opts: Pick<BonusIntro, 'title' | 'sub'>) {
    this.depth.flash(0xf5bd45, 0.3, 300)
    this.depth.shake(4, 420)
    return bonusIntro(this.app, this.fx, MINES_W, MINES_H, { icon: 'dynamite', color: 0xf5bd45, ...opts })
  }

  private fillReel(reel: Container, symbols: string[]) {
    reel.removeChildren().forEach((c) => c.destroy())
    symbols.forEach((sym, row) => {
      const s = cellSprite(sym)
      s.y = row * PITCH
      reel.addChild(s)
    })
  }

  setGrid(grid: string[][]) {
    this.current = grid.map((col) => [...col])
    grid.forEach((col, r) => {
      this.reels[r].y = ORIGIN_Y
      this.fillReel(this.reels[r], col)
    })
    this.clearMarks()
  }

  /** Spin every reel to `grid`; reels stop left to right. */
  async spin(grid: string[][], fast = false) {
    this.clearMarks()
    const previous = this.current
    this.current = grid.map((col) => [...col])
    if (reducedMotion()) {
      this.setGrid(grid)
      await wait(150)
      return
    }
    await Promise.all(
      this.reels.map(async (reel, r) => {
        const filler = fast ? 5 : 9 + r * 3
        const strip: string[] = [
          ...grid[r],
          ...Array.from({ length: filler }, (_, i) => FILLERS[(i * 3 + r) % FILLERS.length]),
          ...previous[r],
        ]
        this.fillReel(reel, strip)
        const travel = (strip.length - ROWS) * PITCH
        reel.y = ORIGIN_Y - travel
        await wait((fast ? 40 : 90) * r)
        if (!this.alive) return
        const blur = new BlurFilter({ strengthX: 0, strengthY: 0, quality: 2 })
        reel.filters = [blur]
        await tween(
          this.app,
          (fast ? 520 : 900) + r * (fast ? 50 : 160),
          (t) => {
            reel.y = ORIGIN_Y - travel * (1 - t)
            // Motion blur follows the speed of the strip and clears as the reel settles.
            blur.strengthY = Math.max(0, 11 * (1 - t) * (1 - t) * (t < 0.04 ? t / 0.04 : 1))
          },
          easeOutBack,
        )
        reel.filters = null
        blur.destroy()
        if (this.alive) {
          this.setReelFinal(r)
          this.depth.shake(1.3, 160)
          this.depth.burst(ORIGIN_X + r * PITCH + CELL / 2, ORIGIN_Y + ROWS * PITCH - 6, { colors: [0x8a93a3, 0x6c6f77, 0xb9bec8], count: 6, speed: 80, gravity: 240, life: 0.5, size: 4, up: true })
        }
      }),
    )
  }

  private setReelFinal(r: number) {
    this.reels[r].y = ORIGIN_Y
    this.fillReel(this.reels[r], this.current[r])
  }

  clearMarks() {
    this.marks.clear()
    this.reels.forEach((reel) => reel.children.forEach((c) => (c.alpha = 1)))
  }

  /** Outline the winning cells and dim the rest. */
  highlight(cells: [number, number][], color = 0xf5bd45) {
    this.marks.clear()
    const lit = new Set(cells.map(([r, row]) => `${r}:${row}`))
    this.reels.forEach((reel, r) =>
      reel.children.forEach((c, row) => (c.alpha = lit.size === 0 || lit.has(`${r}:${row}`) ? 1 : 0.38)),
    )
    for (const [r, row] of cells) {
      this.marks
        .rect(ORIGIN_X + r * PITCH - 3, ORIGIN_Y + row * PITCH - 3, CELL + 6, CELL + 6)
        .stroke({ width: 4, color })
        .rect(ORIGIN_X + r * PITCH, ORIGIN_Y + row * PITCH, CELL, CELL)
        .fill({ color, alpha: 0.14 })
      this.depth.burst(ORIGIN_X + r * PITCH + CELL / 2, ORIGIN_Y + row * PITCH + CELL / 2, { colors: [color, 0xffffff], count: 5, speed: 110, gravity: 120, life: 0.6, size: 4 })
    }
  }
}
