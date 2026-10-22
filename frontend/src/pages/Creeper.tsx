import { useEffect, useRef, useState } from 'react'
import { ApiError, startRound } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { coins } from '../format.ts'
import { CREEPER_H, CREEPER_W, CreeperScene } from '../game/creeperScene.ts'
import type { Wave } from '../game/creeperScene.ts'
import { sfx } from '../game/sound.ts'
import { PixiStage, wait } from '../game/stage.tsx'
import { BetControl, useBet, useGameInfo } from '../ui/bet.tsx'
import { AutoControl, SessionStats, SpeedControl, useAutoplay, useSession, useSpaceKey } from '../ui/play.tsx'
import { CreeperRules } from '../ui/rules.tsx'
import { useWinBanner } from '../ui/win.tsx'
import { PageHead } from '../ui/shell.tsx'

export default function Creeper() {
  const { user, setBalance } = useAuth()
  const info = useGameInfo('creeper')
  const [bet, setBet] = useBet('creeper', info)
  const scene = useRef<CreeperScene | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('Сделайте ставку и крутите.')
  const [error, setError] = useState('')
  const [running, setRunning] = useState<number | null>(null)
  const [wave, setWave] = useState<{ n: number; mult: number } | null>(null)
  const [creeperMult, setCreeperMult] = useState<number | null>(null)

  const auto = useAutoplay()
  const session = useSession()
  const banner = useWinBanner()

  const balance = user?.balance ?? 0

  async function spin() {
    const autoOn = auto.active
    setBusy(true)
    setError('')
    setRunning(null)
    setWave(null)
    setCreeperMult(null)
    const s = scene.current!
    try {
      const r = await startRound('creeper', bet)
      const v = r.view
      setBalance(r.balance - r.payout)
      setNote('Блоки падают…')
      sfx.spin()
      await s.dropIn(v.grid)
      sfx.stop(3)
      const waves = v.waves as Wave[]
      let total = 0
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i]
        const next: string[][] = i + 1 < waves.length ? waves[i + 1].grid : v.final_grid
        setWave({ n: i + 1, mult: w.multiplier })
        setNote(
          w.clusters.length === 1
            ? `Кластер из ${w.clusters[0].count} блоков`
            : `Кластеров в волне: ${w.clusters.length}`,
        )
        total += w.win
        sfx.explode(i)
        setRunning(total)
        if (v.capped && i === waves.length - 1) {
          // The cap stopped the chain before this wave exploded: show it, do not drop new blocks.
          await s.playWave(w, w.grid)
        } else {
          await s.playWave(w, next)
        }
      }
      const mult = v.creeper_multiplier as number
      if (waves.length > 0 && mult > 1) {
        setCreeperMult(mult)
        setNote(`Крипер: весь выигрыш ×${mult}`)
        sfx.creeper()
        await s.flashCreepers()
        await wait(250)
      }
      setRunning(r.payout > 0 ? r.payout : null)
      setBalance(r.balance)
      if (r.payout === 0) setNote('В этот раз без выигрыша.')
      else if (v.capped) setNote(`Достигнут лимит выигрыша — 100× ставки: ${coins(r.payout)}.`)
      else setNote(`Выигрыш ${coins(r.payout)}.`)
      session.spin(bet, r.payout)
      if (r.payout > 0) banner.show(r.payout, bet)
      else sfx.lose()
      if (autoOn) auto.report({ cost: bet, win: r.payout, bet, bonus: false })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Что-то пошло не так.')
      setBalance(user?.balance ?? 0)
      auto.stop('Автоспины остановлены из-за ошибки.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!auto.active || busy || !ready) return
    if (bet > balance) {
      auto.stop('Остановлено: не хватает монет.')
      return
    }
    const t = setTimeout(() => void spin(), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.active, auto.remaining, busy, ready])

  useSpaceKey(() => void spin(), ready && !busy && !auto.active && bet <= balance && Boolean(info))

  return (
    <>
      <PageHead title="Крипер" sub="6×5. Восемь одинаковых блоков где угодно — взрыв и каскад." />
      <div className="play">
        <div className="play-stage">
          <PixiStage
            width={CREEPER_W}
            height={CREEPER_H}
            label="Игровое поле Крипера: шесть колонок по пять блоков"
            onReady={({ app, world }) => {
              const s = new CreeperScene(app, world)
              scene.current = s
              setReady(true)
              return () => {
                s.destroy()
                scene.current = null
              }
            }}
          />
          {wave ? (
            <div className="badge" role="status">
              Волна {wave.n} · ×{wave.mult}
              {creeperMult ? ` · Крипер ×${creeperMult}` : ''}
            </div>
          ) : null}
          {banner.node}
          <div className="stage-status" aria-live="polite">
            <p className="status-line">{note}</p>
            {running !== null ? (
              <p className="win-total">
                Выигрыш <strong>{coins(running)}</strong>
              </p>
            ) : null}
          </div>
        </div>

        <div className="play-panel">
          <BetControl info={info} bet={bet} setBet={setBet} disabled={busy} balance={balance} />
          <button type="button" className="btn btn-primary btn-wide btn-spin" disabled={busy || !info || bet > balance || !ready} onClick={() => void spin()}>
            {busy ? 'Идёт раунд…' : 'Крутить'}
          </button>
          <AutoControl auto={auto} disabled={busy || bet > balance} hasBonus={false} />
          <SpeedControl />
          <SessionStats stats={session.stats} onReset={session.reset} />
          {bet > balance && !busy ? <p className="form-error">Не хватает монет. <a href="#/wallet">Пополнить</a></p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      </div>

      <CreeperRules />
    </>
  )
}
