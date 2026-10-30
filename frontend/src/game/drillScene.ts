import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { coins, reducedMotion } from '../format.ts'
import { textureOf } from './sprites.ts'
import type { SpriteName } from './sprites.ts'
import { Fx, bevel, depthWash, glow, shadow } from './fx.ts'
import { easeInOut, easeOut, easeOutBack, tween, wait } from './stage.tsx'

export const DRILL_COLS = 5
export const DEPTH = 7
const CELL = 52
const GAP = 4
const PITCH = CELL + GAP
const SCALE = CELL / 16
export const DRILL_W = 420
const TOOL_ROW = 24
const MINE_TOP = TOOL_ROW + PITCH + 10
const CHEST_TOP = MINE_TOP + DEPTH * PITCH + 6
export const DRILL_H = CHEST_TOP + PITCH + 24
const OX = (DRILL_W - (DRILL_COLS * PITCH - GAP)) / 2

export type Broken = [number, number, string]
export type DrillStep = {
  col: number
  tool: string
  impact: number
  broken: Broken[]
  win: number
  opened: { col: number; prize: number; grand: boolean }[]
}
export type DrillChest = { prize: number; grand: boolean }

const BLOCKS: Record<string, SpriteName> = {
  dirt: 'dirt',
  stone: 'stone',
  coal: 'coal',
  iron: 'iron',
  redstone: 'redstone',
  gold: 'gold',
  diamond: 'diamond',
  obsidian: 'obsidian',
}
const FRAGMENT: Record<string, number[]> = {
  dirt: [0x8a5a36, 0x6f4527],
  stone: [0x6c6f77, 0x595c63],
  coal: [0x18181b, 0x6c6f77],
  iron: [0xd9b9a3, 0x6c6f77],
  redstone: [0xd92d2d, 0x6c6f77],
  gold: [0xf7d84c, 0x6c6f77],
  diamond: [0x4fe3dc, 0x6c6f77],
  obsidian: [0x24153f, 0x6a3fb0],
}
const PICK_TINT: Record<string, number> = {
  wood: 0xc08850,
  stone_pick: 0xa8a8b0,
  iron_pick: 0xffffff,
  diamond_pick: 0x6ff0ea,
  netherite: 0x6e5c78,
}
export const TOOL_NAMES: Record<string, string> = {
  wood: 'деревянная кирка',
  stone_pick: 'каменная кирка',
  iron_pick: 'железная кирка',
  diamond_pick: 'алмазная кирка',
  netherite: 'незеритовая кирка',
  tnt: 'динамит',
  drill: 'бур',
}

const cx = (c: number) => OX + c * PITCH + CELL / 2
const mineY = (r: number) => MINE_TOP + r * PITCH + CELL / 2
const toolY = () => TOOL_ROW + CELL / 2
const chestY = () => CHEST_TOP + CELL / 2

function sprite(name: SpriteName, tint = 0xffffff, bevelled = true): Container {
  const box = new Container()
  const s = new Sprite(textureOf(name))
  s.scale.set(SCALE)
  s.tint = tint
  box.addChild(s)
  if (bevelled) box.addChild(bevel(CELL))
  box.pivot.set(CELL / 2)
  return box
}

function toolSprite(tool: string): Container {
  // Tools are loose items, not blocks: no bevel, a drop shadow instead.
  const item = tool === 'tnt' ? sprite('dynamite', 0xffffff, false) : tool === 'drill' ? sprite('drill', 0xffffff, false) : sprite('pickaxe', PICK_TINT[tool] ?? 0xffffff, false)
  return item
}

export class DrillScene {
  private blocks: (Container | null)[][] = []
  private chests: Container[] = []
  private tools: (Container | null)[] = []
  private layer = new Container()
  private fx = new Container()
  private alive = true
  private app: Application
  private depth: Fx

  constructor(app: Application, world: Container) {
    this.app = app
    this.depth = new Fx(app, world, DRILL_W, DRILL_H)
    const wall = new TilingSprite({ texture: textureOf('cave'), width: DRILL_W + 40, height: DRILL_H + 30 })
    wall.position.set(-20, -15)
    wall.tileScale.set(SCALE / 1.5)
    this.depth.back.addChild(wall)
    this.depth.ambient([0x8a93a3, 0x6c6f77, 0xb9bec8], 14, 8, 8)
    world = this.depth.front
    const floor = shadow(DRILL_COLS * PITCH, 0.5)
    floor.position.set(DRILL_W / 2, CHEST_TOP + PITCH + 6)
    world.addChild(floor)
    const frame = new Graphics()
      .rect(OX - 8, MINE_TOP - 8, DRILL_COLS * PITCH - GAP + 16, DEPTH * PITCH - GAP + 16)
      .fill(0x101216)
      .rect(OX - 8, CHEST_TOP - 6, DRILL_COLS * PITCH - GAP + 16, PITCH + 8)
      .fill(0x16110b)
      .rect(OX - 8, TOOL_ROW - 6, DRILL_COLS * PITCH - GAP + 16, PITCH + 6)
      .fill(0x1c1812)
    const wells = new Graphics()
    for (let c = 0; c < DRILL_COLS; c++) {
      for (let r = 0; r < DEPTH; r++) wells.rect(OX + c * PITCH, MINE_TOP + r * PITCH, CELL, CELL).fill(0x1b1e25)
      wells.rect(OX + c * PITCH, TOOL_ROW, CELL, CELL).fill(0x2a241a)
    }
    // The deeper the layer, the darker: the mine gets its depth from a wash laid over the blocks.
    const wash = depthWash(DRILL_COLS * PITCH - GAP, DEPTH * PITCH - GAP, 0x000000, 0x1a0a2a, 0.5)
    wash.position.set(OX, MINE_TOP)
    world.addChild(frame, wells, this.layer, wash, this.fx)
    this.depth.raise()
    this.setMine(
      Array.from({ length: DRILL_COLS }, (_, c) => Array.from({ length: DEPTH }, (_, r) => ['dirt', 'stone', 'coal', 'iron'][(c + r) % 4])),
      [],
    )
  }

  destroy() {
    this.alive = false
    this.depth.destroy()
  }

  /** Show a mine with closed chests; `tools` is empty until they are dealt. */
  setMine(mine: string[][], tools: string[]) {
    this.layer.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.fx.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.blocks = mine.map((col, c) =>
      col.map((kind, r) => {
        const box = sprite(BLOCKS[kind] ?? 'stone')
        box.position.set(cx(c), mineY(r))
        this.layer.addChild(box)
        return box
      }),
    )
    this.chests = Array.from({ length: DRILL_COLS }, (_, c) => {
      const box = sprite('chest')
      box.position.set(cx(c), chestY())
      this.layer.addChild(box)
      return box
    })
    this.tools = tools.map((tool, c) => {
      if (tool === 'none') return null
      const box = toolSprite(tool)
      box.position.set(cx(c), toolY())
      this.layer.addChild(box)
      return box
    })
  }

  /** Deal the mine: the blocks drop in column by column, then the tools drop into the top panel. */
  async deal(mine: string[][], tools: string[]) {
    this.setMine(mine, [])
    if (!reducedMotion()) {
      const jobs: Promise<void>[] = []
      this.blocks.forEach((col, c) =>
        col.forEach((box, r) => {
          const target = mineY(r)
          box!.y = -CELL
          jobs.push(wait(c * 60 + r * 20).then(() => (this.alive ? tween(this.app, 380, (t) => (box!.y = -CELL + (target + CELL) * t), easeOutBack) : undefined)))
        }),
      )
      await Promise.all(jobs)
    }
    this.tools = tools.map((tool, c) => {
      if (tool === 'none') return null
      const box = toolSprite(tool)
      box.position.set(cx(c), toolY())
      this.layer.addChild(box)
      return box
    })
    if (!reducedMotion()) {
      await Promise.all(
        this.tools.map((box, c) =>
          box ? wait(c * 90).then(() => (this.alive ? tween(this.app, 360, (t) => {
                box.y = -CELL + (toolY() + CELL) * t
                box.scale.set(1.25 - 0.25 * t)
              }, easeOutBack) : undefined)) : undefined,
        ),
      )
    }
  }

  private burst(c: number, y: number, kind: string, count = 8) {
    if (reducedMotion()) return []
    const colors = FRAGMENT[kind] ?? [0x8a93a3]
    return Array.from({ length: count }, (_, i) => {
      const g = new Graphics().rect(-3, -3, 6, 6).fill(colors[i % colors.length])
      g.position.set(cx(c), y)
      this.fx.addChild(g)
      const a = (Math.PI * 2 * i) / count + c
      return { g, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 30 }
    })
  }

  private async vanish(cells: Broken[]) {
    const fragments = cells.flatMap(([c, r, kind]) => this.burst(c, mineY(r), kind))
    for (const [c, r, kind] of cells) {
      const colors = FRAGMENT[kind] ?? [0x8a93a3]
      this.depth.burst(cx(c), mineY(r), { colors, count: 6, speed: 130, gravity: 480, life: 0.7, size: 5 })
      this.depth.burst(cx(c), mineY(r), { colors: [0x8a93a3, 0xb9bec8], count: 3, speed: 40, gravity: -20, life: 0.9, size: 8 })
      if (kind === 'gold' || kind === 'diamond') this.depth.burst(cx(c), mineY(r), { colors: [0xffffff, colors[0]], count: 4, speed: 70, gravity: -80, life: 0.8, size: 3 })
    }
    const boxes = cells.map(([c, r]) => this.blocks[c]?.[r] ?? null)
    await tween(this.app, 300, (t) => {
      boxes.forEach((box) => {
        if (!box) return
        box.scale.set(t < 0.3 ? 1 + t * 0.4 : 1.12 * (1 - (t - 0.3) / 0.7))
        box.alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7
      })
      fragments.forEach((f, i) => {
        f.g.x += f.vx * 0.016
        f.g.y += f.vy * 0.016 + t * 2
        f.g.alpha = 1 - t
        f.g.rotation = t * (i % 2 ? 3 : -3)
      })
    }, easeOut)
    cells.forEach(([c, r]) => {
      const box = this.blocks[c]?.[r]
      if (box) {
        this.layer.removeChild(box)
        box.destroy({ children: true })
      }
      if (this.blocks[c]) this.blocks[c][r] = null
    })
    this.fx.removeChildren().forEach((g) => g.destroy())
  }

  private async blast(col: number, impact: number) {
    const ring = new Graphics()
    this.fx.addChild(ring)
    const x = cx(col)
    const y = mineY(Math.min(DEPTH - 1, impact + 1))
    this.depth.flash(0xffb02e, 0.4, 240)
    this.depth.shake(7, 420)
    this.depth.ring(x, y, 0xffb02e, 130)
    this.depth.burst(x, y, { colors: [0xffb02e, 0xffe08a, 0xff6a2e, 0x2a2622], count: 22, speed: 230, gravity: 360, life: 0.8, size: 6 })
    await tween(this.app, 320, (t) => {
      ring.clear().rect(x - 20 - t * 90, y - 20 - t * 90, 40 + t * 180, 40 + t * 180).fill({ color: 0xffb02e, alpha: 0.5 * (1 - t) })
    }, easeOut)
    ring.destroy()
  }

  private async popup(col: number, y: number, text: string, color: number) {
    const label = new Text({
      text,
      style: { fontFamily: 'Press Start 2P', fontSize: 14, fill: color, stroke: { color: 0x10210c, width: 5 } },
    })
    label.anchor.set(0.5)
    label.position.set(cx(col), y)
    this.fx.addChild(label)
    await tween(this.app, 700, (t) => {
      label.y = y - 26 * t
      label.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
    }, easeOut)
    label.destroy()
  }

  /** One tool: it falls down its column, breaks what it can, then its column's chest may open. */
  async play(step: DrillStep) {
    const box = this.tools[step.col]
    if (box && step.tool !== 'none') {
      // The tool falls to the block above the first one it works on (the top panel when that is row 0).
      const targetY = mineY(Math.max(0, step.impact - 1))
      await tween(this.app, 420, (t) => (box.y = toolY() + (targetY - toolY()) * t), easeInOut)
      if (step.tool === 'tnt') {
        await this.blast(step.col, step.impact)
        await this.vanish(step.broken)
      } else {
        // A pickaxe or the drill sinks with the column, block after block.
        const drill = step.tool === 'drill'
        for (const b of step.broken) {
          const startY = box.y
          if (drill) this.depth.shake(3, 260)
          this.depth.burst(cx(step.col), mineY(b[1]) - CELL / 2, { colors: [0xffffff, 0xffe08a, 0xf5bd45], count: drill ? 8 : 5, speed: 150, gravity: 400, life: 0.4, size: 3 })
          await Promise.all([
            this.vanish([b]),
            tween(this.app, drill ? 200 : 260, (t) => {
              box.y = startY + (mineY(b[1]) - startY) * t
              // A pickaxe swings into every block; the drill shudders.
              box.rotation = drill ? Math.sin(t * 40) * 0.08 : Math.sin(t * Math.PI) * -0.55
            }, easeOut),
          ])
        }
        box.rotation = 0
      }
      this.layer.removeChild(box)
      box.destroy({ children: true })
      this.tools[step.col] = null
    }
    for (const chest of step.opened) await this.openChest(chest.col, chest.prize, chest.grand)
  }

  private async openChest(col: number, prize: number, grand: boolean) {
    const old = this.chests[col]
    const open = sprite('chestopen')
    open.position.set(old.x, old.y)
    this.layer.addChild(open)
    this.layer.removeChild(old)
    old.destroy({ children: true })
    this.chests[col] = open
    if (!reducedMotion()) {
      await tween(this.app, 360, (t) => open.scale.set(1 + Math.sin(t * Math.PI) * (grand ? 0.4 : 0.22)), easeInOut)
    }
    const x = cx(col)
    this.depth.flash(0xffd34d, grand ? 0.45 : 0.18, grand ? 500 : 260)
    this.depth.shake(grand ? 7 : 2.5, grand ? 600 : 260)
    this.depth.ring(x, chestY(), 0xffd34d, grand ? 190 : 100)
    this.depth.burst(x, chestY() - 10, { colors: [0xffd34d, 0xfff0a0, 0xe9b52b, 0xffffff], count: grand ? 40 : 16, speed: grand ? 300 : 200, gravity: 520, life: 1.1, size: 6, up: true })
    const beam = glow(0, 0, 90, 0xffe08a, 5, 0.08)
    beam.scale.set(0.5, 1.7)
    beam.position.set(x, chestY() - 70)
    this.depth.layer.addChildAt(beam, 0)
    void tween(this.app, 900, (t) => (beam.alpha = 1 - t), easeOut).then(() => beam.destroy())
    await this.popup(col, chestY() - 4, `+${coins(prize)}`, grand ? 0xffd34d : 0xfff0a0)
  }

  /** Mark the main chest by a gold frame so the player knows what they dig toward. */
  markGrand(chests: DrillChest[]) {
    chests.forEach((chest, c) => {
      if (!chest.grand) return
      const frame = new Graphics().rect(OX + c * PITCH - 3, CHEST_TOP - 3, CELL + 6, CELL + 6).stroke({ width: 3, color: 0xffd34d })
      this.layer.addChild(frame)
    })
  }
}
