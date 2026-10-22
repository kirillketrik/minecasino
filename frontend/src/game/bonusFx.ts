import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Application } from 'pixi.js'
import { textureOf } from './sprites.ts'
import type { SpriteName } from './sprites.ts'
import { easeOut, easeOutBack, tween, wait } from './stage.tsx'

export type BonusIntro = {
  /** The symbol that triggered the bonus, shown large. */
  icon: SpriteName
  title: string
  sub: string
  color: number
}

const FONT = 'Press Start 2P'
const SHARDS = 22

/**
 * The moment a bonus is won: the field dims, the trigger symbol slams in, square shock rings and
 * shards fly out, and the title and number of free spins appear. Resolves once it has faded away.
 * Under reduced motion every tween is instant, so only the short holds remain.
 */
export async function bonusIntro(app: Application, parent: Container, width: number, height: number, opts: BonusIntro) {
  const layer = new Container()
  parent.addChild(layer)
  const cx = width / 2
  const cy = height / 2 - 30

  const dim = new Graphics().rect(0, 0, width, height).fill(0x000000)
  dim.alpha = 0
  const rings = [new Graphics(), new Graphics()]
  const shards = new Container()
  const icon = new Sprite(textureOf(opts.icon))
  icon.anchor.set(0.5)
  icon.position.set(cx, cy)
  icon.scale.set(1)
  icon.alpha = 0
  const title = new Text({
    text: opts.title,
    style: { fontFamily: FONT, fontSize: 30, fill: opts.color, stroke: { color: 0x10101a, width: 8 }, align: 'center' },
  })
  title.anchor.set(0.5)
  title.position.set(cx, cy + 108)
  title.alpha = 0
  const sub = new Text({
    text: opts.sub,
    style: { fontFamily: FONT, fontSize: 16, fill: 0xffffff, stroke: { color: 0x10101a, width: 5 }, align: 'center' },
  })
  sub.anchor.set(0.5)
  sub.position.set(cx, cy + 148)
  sub.alpha = 0
  layer.addChild(dim, ...rings, shards, icon, title, sub)

  const pieces = Array.from({ length: SHARDS }, (_, i) => {
    const g = new Graphics().rect(-4, -4, 8, 8).fill(i % 3 === 0 ? 0xffffff : opts.color)
    g.position.set(cx, cy)
    g.alpha = 0
    shards.addChild(g)
    const angle = (i / SHARDS) * Math.PI * 2 + (i % 2) * 0.12
    return { g, dx: Math.cos(angle), dy: Math.sin(angle), reach: 150 + (i % 4) * 45 }
  })

  const ring = (g: Graphics, from: number, to: number, t: number) => {
    const size = from + (to - from) * t
    g.clear().rect(cx - size, cy - size, size * 2, size * 2).stroke({ width: 6, color: opts.color })
    g.alpha = 1 - t
  }

  // The field dims while the symbol slams in and the first ring leaves it.
  await Promise.all([
    tween(app, 260, (t) => (dim.alpha = 0.78 * t)),
    tween(
      app,
      520,
      (t) => {
        icon.alpha = Math.min(1, t * 3)
        icon.scale.set(2 + 5 * t)
      },
      easeOutBack,
    ),
    tween(app, 700, (t) => ring(rings[0], 64, width * 0.55, t)),
  ])

  // Shards burst out, a second ring follows and the text rises in.
  await Promise.all([
    tween(app, 800, (t) => {
      for (const p of pieces) {
        p.g.position.set(cx + p.dx * p.reach * t, cy + p.dy * p.reach * t)
        p.g.alpha = 1 - t
        p.g.rotation = t * 3 * p.dx
      }
    }),
    tween(app, 650, (t) => ring(rings[1], 64, width * 0.4, t)),
    tween(app, 420, (t) => {
      title.alpha = t
      title.y = cy + 108 + (1 - t) * 18
    }),
    wait(160).then(() =>
      tween(app, 420, (t) => {
        sub.alpha = t
        sub.y = cy + 148 + (1 - t) * 18
      }),
    ),
  ])

  // Hold, with the symbol breathing, then fade everything out.
  await tween(
    app,
    900,
    (t) => icon.scale.set(7 + Math.sin(t * Math.PI * 4) * 0.35),
    (t) => t,
  )
  await tween(
    app,
    320,
    (t) => {
      layer.alpha = 1 - t
    },
    easeOut,
  )
  layer.destroy({ children: true })
}
