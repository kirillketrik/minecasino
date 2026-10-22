import { useEffect, useRef, useState } from 'react'
import { ApiError, recentRounds, roundAction, startRound } from '../api.ts'
import type { View } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { coins } from '../format.ts'
import { MINES_H, MINES_W, MinesScene, winCells } from '../game/minesScene.ts'
import type { Win } from '../game/minesScene.ts'
import { dataUrl } from '../game/sprites.ts'
import { sfx } from '../game/sound.ts'
import { PixiStage, wait } from '../game/stage.tsx'
import { BetControl, useBet, useGameInfo } from '../ui/bet.tsx'
import { AutoControl, SessionStats, SpeedControl, useAutoplay, useSession, useSpaceKey } from '../ui/play.tsx'
import { MinesRules } from '../ui/rules.tsx'
import { useWinBanner } from '../ui/win.tsx'
import { PageHead } from '../ui/shell.tsx'

type Pending = { id: number; pot: number; canGamble: boolean; gambles: number }

export default function Mines() {
  const { user, setBalance } = useAuth()
  const info = useGameInfo('mines')
  const [bet, setBet] = useBet('mines', info)
  const scene = useRef<MinesScene | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('Сделайте ставку и крутите.')
  const [error, setError] = useState('')
  const [running, setRunning] = useState<number | null>(null)
  const [bonus, setBonus] = useState<{ n: number; mult: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [scatter, setScatter] = useState(() => {
    try {
      return localStorage.getItem('minebet.mines.scatter') === '1'
    } catch {
      return false
    }
  })
  const [confirmBuy, setConfirmBuy] = useState(false)
  const [crystal, setCrystal] = useState<{ pick: string; got: string } | null>(null)

  const auto = useAutoplay()
  const session = useSession()
  const banner = useWinBanner()

  const balance = user?.balance ?? 0
  const scatterPrice = info?.modes.scatter ?? 0
  const buyPrice = info?.modes.buy_bonus ?? 0
  const spinCost = scatter && scatterPrice ? (bet / 20) * scatterPrice : bet
  const buyCost = (bet / 20) * buyPrice
  const toggleScatter = (on: boolean) => {
    setScatter(on)
    try {
      localStorage.setItem('minebet.mines.scatter', on ? '1' : '0')
    } catch {
      /* preference is simply not remembered */
    }
  }

  // A win left uncollected in an earlier visit is shown, not hidden.
  useEffect(() => {
    if (!ready) return
    recentRounds(10)
      .then((rounds) => {
        const open = rounds.find((r) => r.game_id === 'mines' && !r.finished)
        if (!open) return
        scene.current?.setGrid(open.view.grid)
        scene.current?.highlight(winCells(open.view.wins as Win[]))
        setRunning(open.view.pending)
        setPending({ id: open.id, pot: open.view.pending, canGamble: open.view.can_gamble, gambles: open.view.gambles })
        setNote('У вас есть невостребованный выигрыш. Заберите его или рискните.')
      })
      .catch(() => undefined)
  }, [ready])

  async function play(view: View) {
    const s = scene.current!
    sfx.spin()
    await s.spin(view.grid)
    sfx.stop(2)
    const wins = view.wins as Win[]
    if (wins.length) {
      sfx.win()
      s.highlight(winCells(wins))
      setRunning(view.base_win)
      setNote(wins.length === 1 ? 'Выигрышная линия' : `Выигрышных линий: ${wins.length}`)
      await wait(950)
    }
    if (view.free_spins) {
      sfx.dynamite()
      setNote('Три динамита! Десять бесплатных спинов.')
      await wait(1500)
      let total: number = view.base_win
      for (let i = 0; i < view.free_spins.length; i++) {
        const fs = view.free_spins[i]
        setBonus({ n: i + 1, mult: fs.multiplier })
        sfx.spin()
        await s.spin(fs.grid, true)
        if (fs.wins.length) {
          sfx.win(Math.min(4, i))
          s.highlight(winCells(fs.wins as Win[]))
          total += fs.win
          setRunning(total)
          await wait(800)
        } else {
          await wait(260)
        }
      }
      setBonus(null)
      setRunning(view.total_win)
    }
    s.clearMarks()
    if (view.capped) setNote('Достигнут лимит выигрыша — 100× ставки.')
  }

  async function spin(mode?: 'buy_bonus') {
    setConfirmBuy(false)
    const autoOn = auto.active
    setBusy(true)
    setError('')
    setRunning(null)
    setCrystal(null)
    setPending(null)
    scene.current?.clearMarks()
    try {
      const chosen = mode ?? (scatter ? 'scatter' : undefined)
      const r = await startRound('mines', bet, chosen)
      setBalance(r.balance - r.payout)
      setNote(mode ? 'Бонус куплен. Три динамита на поле…' : 'Крутим…')
      await play(r.view)
      const win = (r.view.total_win as number) ?? 0
      session.spin(r.view.cost as number, win)
      if (win > 0) banner.show(win, bet)
      else sfx.lose()
      if (r.finished) {
        setNote('В этот раз без выигрыша.')
      } else if (autoOn) {
        const done = await roundAction(r.id, { type: 'collect' })
        setBalance(done.balance)
        setRunning(win)
        setNote(`Забрано ${coins(win)} монет.`)
      } else {
        setPending({ id: r.id, pot: r.view.pending, canGamble: r.view.can_gamble, gambles: r.view.gambles })
        setNote(`Выигрыш ${coins(win)} — заберите или рискните.`)
        scene.current?.highlight(winCells(r.view.wins as Win[]))
      }
      if (autoOn) auto.report({ cost: r.view.cost as number, win, bet, bonus: Boolean(r.view.free_spins) })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Что-то пошло не так.')
      auto.stop('Автоспины остановлены из-за ошибки.')
    } finally {
      setBusy(false)
    }
  }

  async function collect() {
    if (!pending) return
    setBusy(true)
    try {
      const r = await roundAction(pending.id, { type: 'collect' })
      setBalance(r.balance)
      sfx.cash()
      setNote(`Забрано ${coins(pending.pot)} монет.`)
      setPending(null)
      setRunning(null)
      scene.current?.clearMarks()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось забрать выигрыш.')
    } finally {
      setBusy(false)
    }
  }

  async function gamble(pick: 'red' | 'blue') {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      const r = await roundAction(pending.id, { type: 'gamble', color: pick })
      const got = r.view.crystal as string
      setCrystal({ pick, got })
      await wait(700)
      if (r.finished) {
        sfx.lose()
        session.adjust(-pending.pot)
        setNote(`Выпал ${got === 'red' ? 'красный' : 'синий'} кристалл. Выигрыш сгорел.`)
        setBalance(r.balance)
        setPending(null)
        setRunning(0)
      } else {
        session.adjust(r.view.pending - pending.pot)
        sfx.win(3)
        banner.show(r.view.pending, bet)
        setNote(`Угадали! Выигрыш удвоен до ${coins(r.view.pending)}.`)
        setRunning(r.view.pending)
        setPending({ id: r.id, pot: r.view.pending, canGamble: r.view.can_gamble, gambles: r.view.gambles })
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось рискнуть.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!auto.active || busy || !ready) return
    if (spinCost > balance) {
      auto.stop('Остановлено: не хватает монет.')
      return
    }
    const t = setTimeout(() => void spin(), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.active, auto.remaining, busy, ready])

  useSpaceKey(() => void spin(), ready && !busy && !auto.active && !confirmBuy && spinCost <= balance && Boolean(info))

  return (
    <>
      <PageHead title="Шахта" sub="5×3, 20 линий. Кирка — дикий символ, динамит — бонус." />
      <div className="play">
        <div className="play-stage">
          <PixiStage
            width={MINES_W}
            height={MINES_H}
            label="Игровое поле Шахты: пять барабанов по три блока"
            onReady={({ app, world }) => {
              const s = new MinesScene(app, world)
              scene.current = s
              setReady(true)
              return () => {
                s.destroy()
                scene.current = null
              }
            }}
          />
          {bonus ? (
            <div className="badge" role="status">
              Бонус {bonus.n}/10 · множитель ×{bonus.mult}
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
          {pending ? (
            <section className="pending" aria-label="Невостребованный выигрыш">
              <p className="pending-label">Ждёт выигрыш</p>
              <p className="pending-pot">{coins(pending.pot)}</p>
              <button type="button" className="btn btn-primary btn-wide" disabled={busy} onClick={() => void collect()}>
                Забрать {coins(pending.pot)}
              </button>
              {pending.canGamble ? (
                <div className="gamble">
                  <p className="hint">Угадайте цвет кристалла: верно — выигрыш ×2, неверно — он сгорит. Шанс 50/50.</p>
                  <div className="crystals">
                    {(['red', 'blue'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="crystal"
                        disabled={busy}
                        onClick={() => void gamble(c)}
                        data-hit={crystal ? (crystal.got === c ? 'yes' : 'no') : undefined}
                      >
                        <img src={dataUrl(c === 'red' ? 'crystal-red' : 'crystal-blue', 5)} alt="" />
                        {c === 'red' ? 'Красный' : 'Синий'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="hint">Дальше рисковать нельзя: достигнут предел риска или лимит 100×.</p>
              )}
            </section>
          ) : null}

          <BetControl info={info} bet={bet} setBet={setBet} disabled={busy} balance={balance} />
          {info && scatterPrice ? (
            <label className="check mode">
              <input type="checkbox" checked={scatter} disabled={busy} onChange={(e) => toggleScatter(e.target.checked)} />
              <span>
                Гарантированный динамит на каждом спине: ставка за спин {coins(spinCost)} (×{(scatterPrice / 20).toFixed(2)})
              </span>
            </label>
          ) : null}
          <button type="button" className="btn btn-primary btn-wide btn-spin" disabled={busy || !info || spinCost > balance || !ready} onClick={() => void spin()}>
            {busy ? 'Идёт раунд…' : pending ? 'Забрать и крутить' : `Крутить за ${coins(spinCost)}`}
          </button>
          {info && buyPrice ? (
            confirmBuy ? (
              <div className="buy-confirm" role="group" aria-label="Подтверждение покупки бонуса">
                <p className="hint">Три динамита сразу и 10 бесплатных спинов. Спишется {coins(buyCost)} монет. Максимальный выигрыш по-прежнему 100× ставки.</p>
                <button type="button" className="btn btn-primary btn-wide" disabled={busy || buyCost > balance} onClick={() => void spin('buy_bonus')}>
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
          <SessionStats stats={session.stats} onReset={session.reset} />
          {spinCost > balance && !busy ? <p className="form-error">Не хватает монет. <a href="#/wallet">Пополнить</a></p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      </div>

      <MinesRules />
    </>
  )
}
