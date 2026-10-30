import { Application, Container } from 'pixi.js'
import { useEffect, useRef } from 'react'
import { reducedMotion } from '../format.ts'
import { speedFactor } from './speed.ts'

export type StageContext = { app: Application; world: Container }

type Props = {
  /** Logical size the scene is drawn in; the stage scales to fit its box. */
  width: number
  height: number
  label: string
  /** Called once the renderer is ready. Return a cleanup function. */
  onReady: (ctx: StageContext) => void | (() => void)
}

export function PixiStage({ width, height, label, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const ready = useRef(onReady)
  ready.current = onReady

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let cleanup: void | (() => void)
    const app = new Application()
    let observer: ResizeObserver | undefined

    void (async () => {
      await app.init({
        width: el.clientWidth || width,
        height: el.clientHeight || height,
        backgroundAlpha: 0,
        antialias: false,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })
      if (cancelled) {
        app.destroy(true, { children: true })
        return
      }
      el.appendChild(app.canvas)
      const world = new Container()
      app.stage.addChild(world)
      const fit = () => {
        const w = el.clientWidth || width
        const scale = w / width
        app.renderer.resize(w, Math.round(height * scale))
        world.scale.set(scale)
      }
      fit()
      observer = new ResizeObserver(fit)
      observer.observe(el)
      cleanup = ready.current({ app, world })
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      if (cleanup) cleanup()
      if (app.renderer) app.destroy(true, { children: true })
    }
  }, [width, height])

  return (
    <div
      ref={host}
      className="stage"
      style={{ aspectRatio: `${width} / ${height}`, ["--ar" as string]: width / height }}
      role="img"
      aria-label={label}
    />
  )
}

// --- tweening on the app ticker ----------------------------------------------------------------

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)
export const easeInOut = (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2)
export const easeOutBack = (t: number) => {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** Run `step(progress 0..1)` over `ms` on the ticker. Resolves at the end; instant under reduced motion. */
export function tween(
  app: Application,
  ms: number,
  step: (t: number) => void,
  ease: (t: number) => number = easeOut,
): Promise<void> {
  ms *= speedFactor()
  if (reducedMotion() || ms <= 0) {
    step(1)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let elapsed = 0
    const tick = () => {
      elapsed += app.ticker.deltaMS
      const t = Math.min(1, elapsed / ms)
      step(ease(t))
      if (t >= 1) {
        app.ticker.remove(tick)
        resolve()
      }
    }
    app.ticker.add(tick)
  })
}

export const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, reducedMotion() ? Math.min(ms, 120) : ms * speedFactor()))
