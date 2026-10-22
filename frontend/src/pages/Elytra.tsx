import { useEffect, useRef, useState } from 'react'
import { ApiError, flightSocket, recentRounds, roundAction, session, startRound } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { coins } from '../format.ts'
import { ELYTRA_H, ELYTRA_W, ElytraScene } from '../game/elytraScene.ts'
import { sfx } from '../game/sound.ts'
import { PixiStage } from '../game/stage.tsx'
import { BetControl, useBet, useGameInfo } from '../ui/bet.tsx'
import { SessionStats, useSession, useSpaceKey } from '../ui/play.tsx'
import { ElytraRules } from '../ui/rules.tsx'
import { useWinBanner } from '../ui/win.tsx'
import { PageHead } from '../ui/shell.tsx'

type Flight = { id: number; bet: number; multiplier: number }

export default function Elytra() {
  const { user, setBalance } = useAuth()
  const info = useGameInfo('elytra')
  const [bet, setBet] = useBet('elytra', info)
  const scene = useRef<ElytraScene | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const elapsed = useRef(0)
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const stats = useSession()
  const banner = useWinBanner()
  const [target, setTarget] = useState(() => {
    try {
      return Number(localStorage.getItem('minebet.elytra.auto')) || 0
    } catch {
      return 0
    }
  })
  const targetRef = useRef(target)
  const cashSent = useRef(false)
  const changeTarget = (v: number) => {
    const next = Math.min(100, Math.max(0, v))
    setTarget(next)
    targetRef.current = next
    try {
      localStorage.setItem('minebet.elytra.auto', String(next))
    } catch {
      /* not remembered */
    }
  }

  const balance = user?.balance ?? 0

  function attach(id: number, stake: number) {
    socket.current?.close()
    elapsed.current = 0
    cashSent.current = false
    setFlight({ id, bet: stake, multiplier: 100 })
    const ws = flightSocket(id)
    socket.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ token: session.get() }))
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string)
      if (msg.type === 'tick') {
        elapsed.current = msg.elapsed
        scene.current?.tick(msg.elapsed)
        setFlight((f) => (f ? { ...f, multiplier: msg.multiplier } : f))
        if (targetRef.current >= 1.01 && msg.multiplier >= targetRef.current * 100 && !cashSent.current) {
          cashSent.current = true
          ws.send(JSON.stringify({ action: 'cashout' }))
        }
      } else if (msg.type === 'end') {
        finish(msg.view, msg.payout, msg.balance, stake)
      } else if (msg.type === 'error') {
        setError(String(msg.detail))
      }
    }
    ws.onclose = (ev) => {
      if (socket.current !== ws) return
      socket.current = null
      if (ev.code === 4401 || ev.code === 4404) setError('Не удалось подключиться к полёту.')
    }
  }

  function finish(view: Record<string, number | string>, payout: number, newBalance: number, stake: number) {
    socket.current?.close()
    socket.current = null
    setFlight(null)
    setBalance(newBalance)
    stats.spin(stake, payout)
    if (view.status === 'cashed_out') {
      scene.current?.cashed(view.cashout as number, elapsed.current)
      sfx.cash()
      banner.show(payout, stake)
      const gain = payout - stake
      setResult(
        `Вывод на ${((view.cashout as number) / 100).toFixed(2)}×: ${gain > 0 ? `+${coins(gain)} монет.` : 'ставка возвращена.'}`,
      )
    } else {
      sfx.crash()
      void scene.current?.crashed(view.crash_point as number, elapsed.current)
      setResult(`Элитры сломались на ${((view.crash_point as number) / 100).toFixed(2)}×. Ставка ${coins(stake)} потеряна.`)
    }
  }

  // A flight still in the air when the page was left is picked up again.
  useEffect(() => {
    if (!ready) return
    recentRounds(10)
      .then((rounds) => {
        const open = rounds.find((r) => r.game_id === 'elytra' && !r.finished)
        if (open) {
          setResult('')
          attach(open.id, open.bet)
        }
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => () => socket.current?.close(), [])

  async function takeOff() {
    setStarting(true)
    setError('')
    setResult('')
    scene.current?.idle('Взлёт…')
    try {
      sfx.click()
      const r = await startRound('elytra', bet)
      setBalance(r.balance)
      if (r.finished) {
        finish(r.view, r.payout, r.balance, r.bet)
      } else {
        attach(r.id, r.bet)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось взлететь.')
      scene.current?.idle()
    } finally {
      setStarting(false)
    }
  }

  async function cashOut() {
    if (!flight) return
    setError('')
    const ws = socket.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'cashout' }))
      return
    }
    try {
      const r = await roundAction(flight.id, { type: 'cashout' })
      finish(r.view, r.payout, r.balance, flight.bet)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось вывести.')
    }
  }

  const live = flight !== null
  const potential = flight ? Math.floor((flight.bet * flight.multiplier) / 100) : 0
  const canCash = live && flight.multiplier >= 101

  useSpaceKey(() => void (live ? cashOut() : takeOff()), ready && !starting && (live ? canCash : Boolean(info) && bet <= balance))

  return (
    <>
      <PageHead title="Элитры" sub="Забирайте выигрыш до того, как элитры сломаются." />
      <div className="play">
        <div className="play-stage">
          <PixiStage
            width={ELYTRA_W}
            height={ELYTRA_H}
            label="График полёта: множитель растёт, пока элитры не сломаются"
            onReady={({ app, world }) => {
              const s = new ElytraScene(app, world)
              scene.current = s
              setReady(true)
              return () => {
                s.destroy()
                scene.current = null
              }
            }}
          />
          {banner.node}
          <div className="stage-status" aria-live="polite">
            <p className="status-line">
              {live ? `Ставка ${coins(flight.bet)}. Сейчас можно забрать ${coins(potential)}.` : result || 'Поставьте ставку и взлетайте.'}
            </p>
          </div>
        </div>

        <div className="play-panel">
          <BetControl info={info} bet={bet} setBet={setBet} disabled={live || starting} balance={balance} />
          {live ? (
            <button type="button" className="btn btn-primary btn-wide btn-spin" disabled={!canCash} onClick={() => void cashOut()}>
              {canCash ? `Вывести ${coins(potential)}` : 'Набираем высоту…'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-wide btn-spin" disabled={starting || !info || bet > balance || !ready} onClick={() => void takeOff()}>
              {starting ? 'Взлёт…' : 'Взлететь'}
            </button>
          )}
          <label className="field tool">
            <span>Автовывод на множителе, × (0 — выключен)</span>
            <input inputMode="decimal" value={target || ''} placeholder="0" onChange={(e) => changeTarget(Number(e.target.value.replace(',', '.').replace(/[^d.]/g, '')) || 0)} />
            <small>Работает в вашем браузере: при плохой связи вывод может прийти позже слома. От 1.01 до 100.</small>
          </label>
          <SessionStats stats={stats.stats} onReset={stats.reset} />
          {bet > balance && !live ? <p className="form-error">Не хватает монет. <a href="#/wallet">Пополнить</a></p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      </div>

      <ElytraRules />
    </>
  )
}
