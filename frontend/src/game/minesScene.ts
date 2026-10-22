import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { reducedMotion } from '../format.ts'
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

function cellSprite(symbol: string): Sprite {
  const s = new Sprite(textureOf(SYMBOL_SPRITE[symbol] ?? 'coal'))
  s.scale.set(SCALE)
  return s
}

export class MinesScene {
  private reels: Container[] = []
  private current: string[][] = []
  private marks = new Graphics()
  private alive = true

  private app: Application

  constructor(app: Application, world: Container) {
    this.app = app
    const wall = new TilingSprite({ texture: textureOf('cave'), width: MINES_W, height: MINES_H })
    wall.tileScale.set(SCALE / 1.5)
    world.addChild(wall)

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
    world.addChild(this.marks)
    const idle = Array.from({ length: REELS }, (_, r) =>
      Array.from({ length: ROWS }, (_, row) => FILLERS[(r * 3 + row) % FILLERS.length]),
    )
    this.setGrid(idle)
  }

  destroy() {
    this.alive = false
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
        await tween(
          this.app,
          (fast ? 520 : 900) + r * (fast ? 50 : 160),
          (t) => {
            reel.y = ORIGIN_Y - travel * (1 - t)
          },
          easeOutBack,
        )
        if (this.alive) this.setReelFinal(r)
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
    }
  }
}
