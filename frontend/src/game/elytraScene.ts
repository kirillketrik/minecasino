import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Application } from 'pixi.js'
import { reducedMotion } from '../format.ts'
import { textureOf } from './sprites.ts'
import { easeOut, tween } from './stage.tsx'

export const ELYTRA_W = 800
export const ELYTRA_H = 420
const PLOT = { x0: 76, x1: 772, y0: 26, y1: 372 }
export const GROWTH = 0.1 // keep equal to GROWTH in backend games/elytra.py

const multiplierAt = (elapsed: number) => Math.max(1, Math.min(100, Math.exp(GROWTH * elapsed)))

type Mode = 'idle' | 'flying' | 'crashed' | 'cashed'

const COLORS = { line: 0x62e3e8, crash: 0xee4d4d, win: 0x3fd47a, grid: 0x2c313b, text: 0x8a93a3 }

export class ElytraScene {
  private mode: Mode = 'idle'
  private anchor = { elapsed: 0, at: performance.now() }
  private sky = new Graphics()
  private clouds: { g: Graphics; speed: number }[] = []
  private grid = new Graphics()
  private labels = new Container()
  private curve = new Graphics()
  private glider = new Sprite(textureOf('elytra'))
  private big: Text
  private note: Text
  private frozen = 1
  private frozenElapsed = 0
  private fall = 0
  private alive = true
  private labelKey = ''

  private app: Application

  constructor(app: Application, world: Container) {
    this.app = app
    this.sky.rect(0, 0, ELYTRA_W, ELYTRA_H).fill(0x0c1220)
    for (let i = 0; i < 70; i++) {
      const x = (i * 97 + 31) % ELYTRA_W
      const y = (i * 53 + 17) % ELYTRA_H
      this.sky.rect(x, y, i % 5 === 0 ? 3 : 2, i % 5 === 0 ? 3 : 2).fill({ color: 0xe9ecf1, alpha: 0.18 + (i % 4) * 0.08 })
    }
    world.addChild(this.sky)
    for (let i = 0; i < 6; i++) {
      const g = new Graphics()
      const w = 60 + (i % 3) * 36
      g.rect(0, 0, w, 14).fill({ color: 0x1a2236, alpha: 1 }).rect(14, -14, w - 28, 14).fill({ color: 0x1a2236, alpha: 1 })
      g.position.set((i * 163) % ELYTRA_W, 60 + ((i * 71) % 280))
      world.addChild(g)
      this.clouds.push({ g, speed: 6 + (i % 3) * 5 })
    }
    world.addChild(this.grid, this.labels, this.curve)

    this.glider.scale.set(4)
    this.glider.anchor.set(0.5)
    world.addChild(this.glider)

    this.big = new Text({
      text: '1.00×',
      style: { fontFamily: 'Press Start 2P', fontSize: 56, fill: 0xe9ecf1, stroke: { color: 0x0c1220, width: 8 } },
    })
    this.big.anchor.set(0.5)
    this.big.position.set(ELYTRA_W / 2, 150)
    this.note = new Text({
      text: '',
      style: { fontFamily: 'Golos Text', fontSize: 20, fontWeight: '500', fill: 0xa3acba },
    })
    this.note.anchor.set(0.5)
    this.note.position.set(ELYTRA_W / 2, 206)
    world.addChild(this.big, this.note)

    this.drawGrid(2, 10)
    this.place(0, 1)
    app.ticker.add(this.frame)
  }

  destroy() {
    this.alive = false
    this.app.ticker.remove(this.frame)
  }

  // --- control from the page --------------------------------------------------------------------

  idle(note = 'Поставьте ставку и взлетайте') {
    this.mode = 'idle'
    this.fall = 0
    this.big.text = '1.00×'
    this.big.style.fill = 0xe9ecf1
    this.note.text = note
    this.glider.rotation = 0
    this.glider.alpha = 1
    this.glider.tint = 0xffffff
    this.curve.clear()
    this.drawGrid(2, 10)
    this.place(0, 1)
  }

  /** The server told us how far the flight has gone; the scene keeps counting on its own clock. */
  tick(elapsed: number) {
    if (this.mode === 'crashed' || this.mode === 'cashed') return
    this.mode = 'flying'
    this.anchor = { elapsed, at: performance.now() }
    this.note.text = ''
  }

  cashed(multiplierHundredths: number, elapsed: number) {
    this.mode = 'cashed'
    this.frozen = multiplierHundredths / 100
    this.frozenElapsed = elapsed
    this.big.text = `${this.frozen.toFixed(2)}×`
    this.big.style.fill = COLORS.win
    this.note.text = 'Вывод успешен'
  }

  async crashed(crashHundredths: number, elapsed: number) {
    this.mode = 'crashed'
    this.frozen = crashHundredths / 100
    this.frozenElapsed = elapsed
    this.big.text = `${this.frozen.toFixed(2)}×`
    this.big.style.fill = COLORS.crash
    this.note.text = 'Элитры сломались'
    this.glider.tint = 0xff8a8a
    if (reducedMotion()) return
    await tween(
      this.app,
      900,
      (t) => {
        this.fall = t
      },
      easeOut,
    )
  }

  // --- drawing ----------------------------------------------------------------------------------

  private frame = () => {
    if (!this.alive) return
    const dt = this.app.ticker.deltaMS / 1000
    if (!reducedMotion()) {
      for (const c of this.clouds) {
        const speed = this.mode === 'flying' ? c.speed * 2.5 : this.mode === 'idle' ? c.speed * 0.4 : 0
        c.g.x -= speed * dt
        if (c.g.x < -140) c.g.x = ELYTRA_W + 20
      }
    }
    if (this.mode === 'idle') {
      this.glider.y = PLOT.y1 - 30 + (reducedMotion() ? 0 : Math.sin(performance.now() / 420) * 5)
      return
    }
    const elapsed =
      this.mode === 'flying' ? this.anchor.elapsed + (performance.now() - this.anchor.at) / 1000 : this.frozenElapsed
    const m = this.mode === 'flying' ? multiplierAt(elapsed) : this.frozen
    if (this.mode === 'flying') {
      this.big.text = `${(Math.floor(m * 100) / 100).toFixed(2)}×`
      this.big.style.fill = 0xe9ecf1
    }
    this.draw(elapsed, m)
  }

  private bounds(elapsed: number, m: number) {
    const top = Math.max(2, Math.ceil(m * 1.25))
    const nice = top <= 4 ? top : top <= 10 ? Math.ceil(top / 2) * 2 : Math.ceil(top / 10) * 10
    return { ymax: nice, xmax: Math.max(10, elapsed * 1.12) }
  }

  private px(t: number, m: number, xmax: number, ymax: number) {
    const x = PLOT.x0 + (t / xmax) * (PLOT.x1 - PLOT.x0)
    const y = PLOT.y1 - ((m - 1) / (ymax - 1)) * (PLOT.y1 - PLOT.y0)
    return { x, y }
  }

  private draw(elapsed: number, m: number) {
    const { ymax, xmax } = this.bounds(elapsed, m)
    this.drawGrid(ymax, xmax)
    const color = this.mode === 'crashed' ? COLORS.crash : this.mode === 'cashed' ? COLORS.win : COLORS.line
    this.curve.clear()
    const steps = 90
    for (let i = 0; i <= steps; i++) {
      const t = (elapsed * i) / steps
      const p = this.px(t, multiplierAt(t), xmax, ymax)
      if (i === 0) this.curve.moveTo(p.x, p.y)
      else this.curve.lineTo(p.x, p.y)
    }
    this.curve.stroke({ width: 5, color, join: 'miter', cap: 'butt' })
    const head = this.px(elapsed, m, xmax, ymax)
    const ahead = this.px(elapsed + 0.4, multiplierAt(elapsed + 0.4), xmax, ymax)
    this.place(head.x, head.y, Math.atan2(ahead.y - head.y, ahead.x - head.x) * 0.6, true)
  }

  private place(x: number, y: number, angle = 0, onPlot = false) {
    if (!onPlot) {
      x = PLOT.x0 + 40
      y = PLOT.y1 - 30
    }
    const fall = this.fall
    this.glider.position.set(x, y + fall * 120)
    this.glider.rotation = angle + fall * 2.4
    this.glider.alpha = 1 - fall * 0.6
  }

  private drawGrid(ymax: number, xmax: number) {
    this.grid.clear()
    const step = ymax <= 4 ? 1 : ymax <= 10 ? 2 : ymax <= 50 ? 10 : 20
    const key = `${ymax}:${Math.ceil(xmax / 5)}`
    const rebuild = key !== this.labelKey
    if (rebuild) {
      this.labels.removeChildren().forEach((c) => c.destroy())
      this.labelKey = key
    }
    for (let v = 1; v <= ymax; v += step) {
      const y = PLOT.y1 - ((v - 1) / (ymax - 1)) * (PLOT.y1 - PLOT.y0)
      this.grid.moveTo(PLOT.x0, y).lineTo(PLOT.x1, y).stroke({ width: 1, color: COLORS.grid })
      if (rebuild) {
        const label = new Text({ text: `${v}×`, style: { fontFamily: 'Golos Text', fontSize: 14, fill: COLORS.text } })
        label.anchor.set(1, 0.5)
        label.position.set(PLOT.x0 - 10, y)
        this.labels.addChild(label)
      }
    }
    this.grid.moveTo(PLOT.x0, PLOT.y1).lineTo(PLOT.x1, PLOT.y1).stroke({ width: 2, color: 0x4a515e })
  }
}
