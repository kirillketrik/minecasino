/**
 * What every game page shares: the player's balance and bet, session stats and the win banner
 * (`useGame`), the Pixi scene lifecycle (`useScene`, `GameStage`) and, for paid-spin slots, the
 * whole control column and autoplay loop (`useSlot`, `SlotPanel`, `useSlotLoop`).
 * A game page keeps only its own rules: how a round is played and drawn.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { coins } from '../format.ts'
import { enterTheme, leaveTheme, setMusic, setSound, sfx, useMusic, useSound } from '../game/sound.ts'
import type { Theme } from '../game/sound.ts'
import { PixiStage } from '../game/stage.tsx'
import type { StageContext } from '../game/stage.tsx'
import { BetControl, useBet, useGameInfo } from './bet.tsx'
import { AutoControl, SessionStats, SpeedControl, useAutoplay, useSession, useSpaceKey } from './play.tsx'
import { useWinBanner } from './win.tsx'

// --- shared state ----------------------------------------------------------------------------------

/** A yes/no preference remembered in this browser. */
export function usePersistedFlag(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback(
    (next: boolean) => {
      setOn(next)
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {
        /* preference is simply not remembered */
      }
    },
    [key],
  )
  return [on, set]
}

const THEMES: Record<string, Theme> = { mines: 'mines', creeper: 'creeper', ender: 'ender', drill: 'drill', elytra: 'elytra' }

export function useGame(id: string) {
  useEffect(() => {
    const theme = THEMES[id]
    if (!theme) return
    enterTheme(theme)
    return () => leaveTheme(theme)
  }, [id])
  const { user, setBalance } = useAuth()
  const info = useGameInfo(id)
  const [bet, setBet] = useBet(id, info)
  const [error, setError] = useState('')
  const session = useSession()
  const banner = useWinBanner()
  const balance = user?.balance ?? 0
  /** Show an API error as is, anything else as `fallback`. */
  const fail = (e: unknown, fallback = 'Что-то пошло не так.') => setError(e instanceof ApiError ? e.message : fallback)
  return { balance, setBalance, info, bet, setBet, error, setError, fail, session, banner }
}

// --- the scene -------------------------------------------------------------------------------------

/** Create a scene once the renderer is ready and destroy it with the page. */
export function useScene<T extends { destroy: () => void }>(create: (ctx: StageContext) => T) {
  const scene = useRef<T | null>(null)
  const [ready, setReady] = useState(false)
  const onReady = (ctx: StageContext) => {
    const s = create(ctx)
    scene.current = s
    setReady(true)
    return () => {
      s.destroy()
      scene.current = null
    }
  }
  return { scene, ready, onReady }
}

type StageProps = {
  width: number
  height: number
  label: string
  onReady: (ctx: StageContext) => void | (() => void)
  banner: ReactNode
  /** Small status chip over the field (bonus counter, wave). */
  badge?: ReactNode
  note: ReactNode
  /** Running win shown under the note; nothing when null or omitted. */
  running?: number | null
}

const ICONS = {
  sound: 'M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.4-2.4-1.4-1.4-2.4 2.4-2.4-2.4-1.4 1.4 2.4 2.4-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4-2.4-2.4z',
  music: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z',
  musicOff: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6zM3 4.4 4.4 3 21 19.6 19.6 21 3 4.4z',
  expand: 'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z',
  shrink: 'M8 4h2v6H4V8h4V4zm6 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z',
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d={d} />
    </svg>
  )
}

/** Sound, music and full screen, in the corner of the stage. */
function StageTools({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const sound = useSound()
  const music = useMusic()
  const [full, setFull] = useState(false)
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === target.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [target])
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void target.current?.requestFullscreen?.().catch(() => undefined)
  }
  const canFull = typeof document !== 'undefined' && document.fullscreenEnabled
  return (
    <div className="stage-tools" role="group" aria-label="Звук и экран">
      <button type="button" className="tool-btn" aria-pressed={sound} aria-label="Звуки" title={sound ? 'Выключить звуки' : 'Включить звуки'} onClick={() => { setSound(!sound); if (!sound) sfx.click() }}>
        <Icon d={sound ? ICONS.sound : ICONS.mute} />
      </button>
      <button type="button" className="tool-btn" aria-pressed={music} aria-label="Музыка" title={music ? 'Выключить музыку' : 'Включить музыку'} onClick={() => setMusic(!music)}>
        <Icon d={music ? ICONS.music : ICONS.musicOff} />
      </button>
      {canFull ? (
        <button type="button" className="tool-btn" aria-pressed={full} aria-label="Во весь экран" title={full ? 'Выйти из полноэкранного режима' : 'Во весь экран'} onClick={toggleFull}>
          <Icon d={full ? ICONS.shrink : ICONS.expand} />
        </button>
      ) : null}
    </div>
  )
}

export function GameStage({ width, height, label, onReady, banner, badge, note, running }: StageProps) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <div className="play-stage" ref={box}>
      <PixiStage width={width} height={height} label={label} onReady={onReady} />
      <StageTools target={box} />
      {badge ? (
        <div className="badge" role="status">
          {badge}
        </div>
      ) : null}
      {banner}
      <div className="stage-status" aria-live="polite">
        <p className="status-line">{note}</p>
        {running !== null && running !== undefined ? (
          <p className="win-total">
            Выигрыш <strong>{coins(running)}</strong>
          </p>
        ) : null}
      </div>
    </div>
  )
}

// --- paid-spin slots -------------------------------------------------------------------------------

/**
 * State of a slot page on top of `useGame`: the round flags, the optional per-spin mode (guaranteed
 * scatter, ante bet) and the bought bonus, with their prices. Prices are in 1/20 of the bet.
 */
export function useSlot(id: string, modeId: string) {
  const game = useGame(id)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('Сделайте ставку и крутите.')
  const [running, setRunning] = useState<number | null>(null)
  const [modeOn, setModeOn] = usePersistedFlag(`minebet.${id}.${modeId}`)
  const [confirmBuy, setConfirmBuy] = useState(false)
  const auto = useAutoplay()

  const modePrice = game.info?.modes[modeId] ?? 0
  const buyPrice = game.info?.modes.buy_bonus ?? 0
  const unit = game.bet / 20
  const spinCost = modeOn && modePrice ? unit * modePrice : game.bet
  const buyCost = unit * buyPrice
  /** The mode id to send for the next round. */
  const roundMode = (buy: boolean) => (buy ? 'buy_bonus' : modeOn ? modeId : undefined)

  return {
    ...game,
    busy,
    setBusy,
    note,
    setNote,
    running,
    setRunning,
    modeOn,
    setModeOn,
    modePrice,
    buyPrice,
    spinCost,
    buyCost,
    roundMode,
    confirmBuy,
    setConfirmBuy,
    auto,
  }
}

export type Slot = ReturnType<typeof useSlot>

/** Autoplay keeps spinning while it can; the space bar spins by hand. */
export function useSlotLoop(slot: Slot, ready: boolean, spin: () => void) {
  const { auto, busy, balance, spinCost, info, confirmBuy } = slot
  useEffect(() => {
    if (!auto.active || busy || !ready) return
    if (spinCost > balance) {
      auto.stop('Остановлено: не хватает монет.')
      return
    }
    const t = setTimeout(spin, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.active, auto.remaining, busy, ready])

  useSpaceKey(spin, ready && !busy && !auto.active && !confirmBuy && spinCost <= balance && Boolean(info))
}

type PanelProps = {
  slot: Slot
  ready: boolean
  /** Starts a round; `buy` is true for the bought bonus. */
  onSpin: (buy: boolean) => void
  /** Title of the per-spin mode checkbox; the price is appended. */
  modeTitle: string
  /** What the bought bonus gives, shown on its confirmation. */
  buyHint: string
  /** Replaces the spin button's text (e.g. while a win waits to be collected). */
  spinLabel?: string
  /** Shown above the bet (an uncollected win). */
  above?: ReactNode
}

export function SlotPanel({ slot, ready, onSpin, modeTitle, buyHint, spinLabel, above }: PanelProps) {
  const { info, bet, setBet, busy, balance, spinCost, buyCost, modeOn, setModeOn, modePrice, buyPrice, confirmBuy, setConfirmBuy, auto } = slot
  return (
    <div className="play-panel">
      {above}
      <BetControl info={info} bet={bet} setBet={setBet} disabled={busy} balance={balance} />
      {info && modePrice ? (
        <label className="check mode">
          <input type="checkbox" checked={modeOn} disabled={busy} onChange={(e) => setModeOn(e.target.checked)} />
          <span>
            {modeTitle}: ставка за спин {coins(spinCost)} (×{(modePrice / 20).toFixed(2)})
          </span>
        </label>
      ) : null}
      <button type="button" className="btn btn-primary btn-wide btn-spin" disabled={busy || !info || spinCost > balance || !ready} onClick={() => onSpin(false)}>
        {busy ? 'Идёт раунд…' : (spinLabel ?? `Крутить за ${coins(spinCost)}`)}
      </button>
      {info && buyPrice ? (
        confirmBuy ? (
          <div className="buy-confirm" role="group" aria-label="Подтверждение покупки бонуса">
            <p className="hint">
              {buyHint} Спишется {coins(buyCost)} монет. Максимальный выигрыш по-прежнему {info.max_win_multiplier}× ставки.
            </p>
            <button type="button" className="btn btn-primary btn-wide" disabled={busy || buyCost > balance} onClick={() => onSpin(true)}>
              Купить за {coins(buyCost)}
            </button>
            <button type="button" className="btn btn-wide" onClick={() => setConfirmBuy(false)}>
              Отмена
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-wide" disabled={busy || !ready || buyCost > balance} onClick={() => setConfirmBuy(true)}>
            Купить бонус за {coins(buyCost)}
          </button>
        )
      ) : null}
      <AutoControl auto={auto} disabled={busy || spinCost > balance} hasBonus />
      <SpeedControl />
      <SessionStats stats={slot.session.stats} onReset={slot.session.reset} />
      {spinCost > balance && !busy ? (
        <p className="form-error">
          Не хватает монет. <a href="#/wallet">Пополнить</a>
        </p>
      ) : null}
      {slot.error ? (
        <p className="form-error" role="alert">
          {slot.error}
        </p>
      ) : null}
    </div>
  )
}
