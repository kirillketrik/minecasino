import { Container, FillGradient, Graphics, Sprite } from 'pixi.js'
import type { Application } from 'pixi.js'
import { reducedMotion } from '../format.ts'
import { speedFactor } from './speed.ts'
import { textureOf } from './sprites.ts'
import type { SpriteName } from './sprites.ts'

/**
 * Shared "depth" toolkit of the slot scenes: a parallax rig (back wall and front field move against
 * each other with the pointer), particles with gravity, square shock rings, screen flash and shake,
 * ambient motes and bevelled cubes with a baked light from the top left.
 *
 * Everything here is cosmetic and skipped under reduced motion; nothing waits on it, so the game's
 * own timing never depends on an effect.
 */

export type BurstOptions = {
  colors: number[]
  count?: number
  speed?: number
  /** Pixels per second squared; positive pulls down. */
  gravity?: number
  life?: number
  size?: number
  /** Direction spread: full circle by default, `up` fires a fan upward. */
  up?: boolean
  spin?: boolean
}

type Particle = {
  g: Graphics
  vx: number
  vy: number
  age: number
  life: number
  gravity: number
  spin: number
}

type Mote = { g: Graphics; x: number; y: number; speed: number; phase: number; sway: number }

export class Fx {
  /** Far layer: the wall. Moves against the pointer. */
  readonly back = new Container()
  /** Near layer: the field, cells and everything the player reads. Moves with the pointer. */
  readonly front = new Container()
  private top = new Container()
  private particles: Particle[] = []
  private motes: Mote[] = []
  private rings: { g: Graphics; age: number; life: number; x: number; y: number; r: number; color: number }[] = []
  private flashLayer = new Graphics()
  private flashAge = 0
  private flashLife = 0
  private flashAlpha = 0
  private shakeAge = 0
  private shakeLife = 0
  private shakeAmp = 0
  private pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  private alive = true
  private onMove?: (e: PointerEvent) => void
  private onLeave?: () => void

  private app: Application
  private world: Container
  readonly width: number
  readonly height: number

  constructor(app: Application, world: Container, width: number, height: number) {
    this.app = app
    this.world = world
    this.width = width
    this.height = height
    world.addChild(this.back, this.front)
    this.top.addChild(this.flashLayer)
    this.front.addChild(this.top)
    this.flashLayer.rect(0, 0, width, height).fill(0xffffff)
    this.flashLayer.alpha = 0
    app.ticker.add(this.tick)
    if (!reducedMotion()) {
      const el = app.canvas
      this.onMove = (e) => {
        const box = el.getBoundingClientRect()
        this.pointer.tx = ((e.clientX - box.left) / box.width - 0.5) * 2
        this.pointer.ty = ((e.clientY - box.top) / box.height - 0.5) * 2
      }
      this.onLeave = () => {
        this.pointer.tx = 0
        this.pointer.ty = 0
      }
      el.addEventListener('pointermove', this.onMove)
      el.addEventListener('pointerleave', this.onLeave)
    }
  }

  destroy() {
    this.alive = false
    this.app.ticker?.remove(this.tick)
    if (this.onMove) this.app.canvas?.removeEventListener('pointermove', this.onMove)
    if (this.onLeave) this.app.canvas?.removeEventListener('pointerleave', this.onLeave)
  }

  /** Keep the effects layer above everything the scene added later. */
  raise() {
    this.front.addChild(this.top)
  }

  /** The layer particles and rings are drawn into. */
  get layer() {
    return this.top
  }

  // --- the frame loop ---------------------------------------------------------------------------

  private tick = () => {
    if (!this.alive) return
    const dt = Math.min(this.app.ticker.deltaMS, 50) / 1000
    const scale = this.world.scale.x || 1

    // Parallax: the wall drifts against the pointer, the field a little with it.
    const p = this.pointer
    p.x += (p.tx - p.x) * Math.min(1, dt * 5)
    p.y += (p.ty - p.y) * Math.min(1, dt * 5)
    this.back.position.set(-p.x * 9, -p.y * 7)
    this.front.position.set(p.x * 3, p.y * 2)

    // Shake offsets the whole world, in screen pixels.
    if (this.shakeLife > 0) {
      this.shakeAge += dt * 1000
      const k = Math.max(0, 1 - this.shakeAge / this.shakeLife)
      const amp = this.shakeAmp * k * k * scale
      this.world.position.set((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp)
      if (k <= 0) {
        this.shakeLife = 0
        this.world.position.set(0, 0)
      }
    }

    if (this.flashLife > 0) {
      this.flashAge += dt * 1000
      const k = Math.max(0, 1 - this.flashAge / this.flashLife)
      this.flashLayer.alpha = this.flashAlpha * k * k
      if (k <= 0) this.flashLife = 0
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i]
      q.age += dt
      if (q.age >= q.life) {
        q.g.destroy()
        this.particles.splice(i, 1)
        continue
      }
      q.vy += q.gravity * dt
      q.g.x += q.vx * dt
      q.g.y += q.vy * dt
      q.g.rotation += q.spin * dt
      const t = q.age / q.life
      q.g.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.age += dt
      const t = Math.min(1, r.age / r.life)
      const e = 1 - Math.pow(1 - t, 3)
      const size = 10 + r.r * e
      r.g.clear().rect(r.x - size, r.y - size, size * 2, size * 2).stroke({ width: 5 * (1 - t) + 1, color: r.color, alpha: 1 - t })
      if (t >= 1) {
        r.g.destroy()
        this.rings.splice(i, 1)
      }
    }

    for (const m of this.motes) {
      m.y -= m.speed * dt
      m.phase += dt
      m.g.x = m.x + Math.sin(m.phase * 0.8) * m.sway
      m.g.y = m.y
      m.g.alpha = 0.25 + 0.35 * Math.abs(Math.sin(m.phase * 1.3))
      if (m.y < -8) m.y = this.height + 8
    }
  }

  // --- effects ----------------------------------------------------------------------------------

  /** A spray of square fragments. */
  burst(x: number, y: number, o: BurstOptions) {
    if (reducedMotion()) return
    const count = o.count ?? 10
    const speed = o.speed ?? 120
    for (let i = 0; i < count; i++) {
      const size = (o.size ?? 5) * (0.6 + Math.random() * 0.8)
      const g = new Graphics().rect(-size / 2, -size / 2, size, size).fill(o.colors[i % o.colors.length])
      g.position.set(x, y)
      const a = o.up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2
      const v = speed * (0.4 + Math.random() * 0.9)
      this.top.addChild(g)
      this.particles.push({
        g,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: ((o.life ?? 0.7) * (0.7 + Math.random() * 0.6)) / Math.max(0.35, speedFactor()),
        gravity: o.gravity ?? 260,
        spin: o.spin === false ? 0 : (Math.random() - 0.5) * 10,
      })
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400).forEach((q) => q.g.destroy())
  }

  /** Square shock ring growing out of a point. */
  ring(x: number, y: number, color: number, radius = 120) {
    if (reducedMotion()) return
    const g = new Graphics()
    this.top.addChild(g)
    this.rings.push({ g, age: 0, life: 0.55 / Math.max(0.35, speedFactor()), x, y, r: radius, color })
  }

  flash(color: number, alpha = 0.35, ms = 260) {
    if (reducedMotion()) return
    this.flashLayer.clear().rect(0, 0, this.width, this.height).fill(color)
    this.flashAlpha = alpha
    this.flashAge = 0
    this.flashLife = ms * speedFactor() + 40
  }

  shake(amp: number, ms = 320) {
    if (reducedMotion()) return
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeLife > 0 ? 0.5 : 0), amp)
    this.shakeAge = 0
    this.shakeLife = ms * speedFactor() + 40
  }

  /** Slow drifting specks (embers, void dust, dust in a lamp's light). */
  ambient(colors: number[], count: number, sway = 14, speed = 10) {
    if (reducedMotion()) return
    for (let i = 0; i < count; i++) {
      const size = 2 + Math.floor(Math.random() * 3)
      const g = new Graphics().rect(0, 0, size, size).fill(colors[i % colors.length])
      const x = Math.random() * this.width
      const y = Math.random() * this.height
      g.position.set(x, y)
      this.back.addChild(g)
      this.motes.push({ g, x, y, speed: speed * (0.5 + Math.random()), phase: Math.random() * 10, sway: sway * (0.4 + Math.random()) })
    }
  }
}

// --- baked depth ------------------------------------------------------------------------------

/**
 * A block with a baked light from the top left: a bright upper-left edge, a dark lower-right edge
 * and an inner shade, so flat 16px art reads as a chunky cube. `size` is the on-screen edge.
 */
export function cube(name: SpriteName, size: number, tint = 0xffffff): Container {
  const box = new Container()
  const s = new Sprite(textureOf(name))
  s.scale.set(size / 16)
  s.tint = tint
  box.addChild(s)
  box.addChild(bevel(size))
  box.pivot.set(size / 2)
  return box
}

export function bevel(size: number) {
  const e = Math.max(3, Math.round(size / 14))
  const g = new Graphics()
  g.rect(0, 0, size, e).fill({ color: 0xffffff, alpha: 0.3 })
  g.rect(0, 0, e, size).fill({ color: 0xffffff, alpha: 0.22 })
  g.rect(0, size - e, size, e).fill({ color: 0x000000, alpha: 0.38 })
  g.rect(size - e, 0, e, size).fill({ color: 0x000000, alpha: 0.3 })
  g.rect(e, e, size - e * 2, e).fill({ color: 0xffffff, alpha: 0.08 })
  return g
}

/** A soft contact shadow under something that floats above the field. */
export function shadow(width: number, alpha = 0.35) {
  const g = new Graphics()
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.18
    g.rect(-(width * k) / 2, -3 + i, width * k, 6 - i).fill({ color: 0x000000, alpha: alpha / 3 })
  }
  return g
}

/** A vertical wash, dark at the bottom: depth into a mine, the void below a floating island. */
export function depthWash(width: number, height: number, top: number, bottom: number, alpha: number) {
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bottom },
    ],
    textureSpace: 'local',
  })
  const g = new Graphics().rect(0, 0, width, height).fill(gradient)
  g.alpha = alpha
  return g
}

/** Banded glow, in the pixel style of the art: concentric translucent squares. */
export function glow(cx: number, cy: number, radius: number, color: number, bands = 6, alpha = 0.06) {
  const g = new Graphics()
  for (let i = bands; i >= 1; i--) {
    const r = (radius * i) / bands
    g.rect(cx - r, cy - r, r * 2, r * 2).fill({ color, alpha })
  }
  return g
}
