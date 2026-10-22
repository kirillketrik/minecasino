import { useCallback, useEffect, useRef, useState } from 'react'
import { coins, signed } from '../format.ts'
import { setSound, sfx, useSound } from '../game/sound.ts'
import { SPEEDS, setSpeed, useSpeed } from '../game/speed.ts'

// --- animation speed -----------------------------------------------------------------------------

export function SpeedControl() {
  const speed = useSpeed()
  const sound = useSound()
  return (
    <div className="tool" role="group" aria-label="Скорость вращения">
      <span className="tool-label">Скорость</span>
      <div className="seg">
        {SPEEDS.map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={speed === s.id} onClick={() => setSpeed(s.id)}>
            {s.label}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={sound}
          onClick={() => {
            setSound(!sound)
            if (!sound) sfx.click()
          }}
        >
          Звук: {sound ? 'вкл' : 'выкл'}
        </button>
      </div>
    </div>
  )
}

// --- session statistics --------------------------------------------------------------------------

export type Session = { spins: number; wagered: number; won: number }

export function useSession() {
  const [stats, setStats] = useState<Session>({ spins: 0, wagered: 0, won: 0 })
  const spin = useCallback((cost: number, win: number) => setStats((s) => ({ spins: s.spins + 1, wagered: s.wagered + cost, won: s.won + win })), [])
  /** A later change to an already counted round (risk on a crystal). */
  const adjust = useCallback((delta: number) => setStats((s) => ({ ...s, won: s.won + delta })), [])
  const reset = useCallback(() => setStats({ spins: 0, wagered: 0, won: 0 }), [])
  return { stats, spin, adjust, reset }
}

export function SessionStats({ stats, onReset }: { stats: Session; onReset: () => void }) {
  const net = stats.won - stats.wagered
  return (
    <section className="tool session" aria-label="Итоги сессии">
      <dl>
        <div><dt>Раундов</dt><dd>{stats.spins}</dd></div>
        <div><dt>Поставлено</dt><dd>{coins(stats.wagered)}</dd></div>
        <div><dt>Выиграно</dt><dd>{coins(stats.won)}</dd></div>
        <div><dt>Итог</dt><dd className={net > 0 ? 'plus' : net < 0 ? 'minus' : ''}>{signed(net)}</dd></div>
      </dl>
      <button type="button" className="link" disabled={stats.spins === 0} onClick={onReset}>Сбросить</button>
    </section>
  )
}

// --- autoplay ------------------------------------------------------------------------------------

export type AutoConfig = {
  spins: number
  /** Stop when a round triggers the bonus (only meaningful where the game has one). */
  stopOnBonus: boolean
  /** Stop after a single win of at least this many bets; 0 = off. */
  stopOnWin: number
  /** Stop once the session is down by this many coins; 0 = off. */
  stopOnLoss: number
}

export type RoundReport = { cost: number; win: number; bet: number; bonus: boolean }

export function useAutoplay() {
  const [remaining, setRemaining] = useState(0)
  const [reason, setReason] = useState('')
  const cfg = useRef<AutoConfig>({ spins: 0, stopOnBonus: false, stopOnWin: 0, stopOnLoss: 0 })
  const left = useRef(0)
  const net = useRef(0)

  const finish = useCallback((why: string) => {
    left.current = 0
    setRemaining(0)
    setReason(why)
  }, [])

  const start = useCallback((config: AutoConfig) => {
    cfg.current = config
    net.current = 0
    left.current = config.spins
    setReason('')
    setRemaining(config.spins)
  }, [])

  const report = useCallback(
    (r: RoundReport) => {
      if (left.current <= 0) return
      const c = cfg.current
      net.current += r.win - r.cost
      left.current -= 1
      let why = ''
      if (c.stopOnBonus && r.bonus) why = 'Остановлено: выпал бонус.'
      else if (c.stopOnWin > 0 && r.win >= c.stopOnWin * r.bet) why = `Остановлено: выигрыш ${coins(r.win)}.`
      else if (c.stopOnLoss > 0 && -net.current >= c.stopOnLoss)
        why = `Остановлено: достигнут лимит проигрыша ${coins(c.stopOnLoss)}.`
      else if (left.current === 0) why = 'Автоспины завершены.'
      if (why) finish(why)
      else setRemaining(left.current)
    },
    [finish],
  )

  return { remaining, active: remaining > 0, reason, start, stop: finish, report }
}

type AutoProps = {
  auto: ReturnType<typeof useAutoplay>
  disabled: boolean
  hasBonus: boolean
  /** Why autoplay cannot start right now, if it cannot. */
  blocked?: string
}

const COUNTS = [10, 25, 50, 100]

export function AutoControl({ auto, disabled, hasBonus, blocked }: AutoProps) {
  const [spins, setSpins] = useState(25)
  const [stopOnBonus, setStopOnBonus] = useState(hasBonus)
  const [stopOnWin, setStopOnWin] = useState(0)
  const [stopOnLoss, setStopOnLoss] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (auto.active) setOpen(false)
  }, [auto.active])

  if (auto.active) {
    return (
      <div className="tool">
        <button type="button" className="btn btn-wide" onClick={() => auto.stop('Автоспины остановлены.')}>
          Остановить автоспины ({auto.remaining})
        </button>
      </div>
    )
  }
  return (
    <div className="tool">
      <button type="button" className="btn btn-wide" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Автоспины
      </button>
      {auto.reason ? <p className="hint" role="status">{auto.reason}</p> : null}
      {open ? (
        <div className="auto-form">
          <div className="seg" role="group" aria-label="Количество автоспинов">
            {COUNTS.map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={spins === n} onClick={() => setSpins(n)}>
                {n}
              </button>
            ))}
          </div>
          {hasBonus ? (
            <label className="check">
              <input type="checkbox" checked={stopOnBonus} onChange={(e) => setStopOnBonus(e.target.checked)} />
              <span>Остановить при бонусе</span>
            </label>
          ) : null}
          <label className="field">
            <span>Остановить при выигрыше от, ставок (0 — не останавливать)</span>
            <input inputMode="numeric" value={stopOnWin} onChange={(e) => setStopOnWin(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </label>
          <label className="field">
            <span>Лимит проигрыша, монет (0 — без лимита)</span>
            <input inputMode="numeric" value={stopOnLoss} onChange={(e) => setStopOnLoss(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </label>
          <p className="hint">Автоспины остановятся и при нехватке монет. Выигрыши забираются автоматически, без риска на кристалле.</p>
          {blocked ? <p className="form-error">{blocked}</p> : null}
          <button
            type="button"
            className="btn btn-primary btn-wide"
            disabled={Boolean(blocked)}
            onClick={() => auto.start({ spins, stopOnBonus: hasBonus && stopOnBonus, stopOnWin, stopOnLoss })}
          >
            Запустить {spins} спинов
          </button>
        </div>
      ) : null}
    </div>
  )
}

// --- space bar -----------------------------------------------------------------------------------

/** Space triggers `action` while the player is not typing or focused on another control. */
export function useSpaceKey(action: () => void, enabled: boolean) {
  const latest = useRef(action)
  latest.current = action
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(t.tagName)) return
      e.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
