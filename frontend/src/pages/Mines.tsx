import { useEffect, useState } from 'react'
import { recentRounds, roundAction, startRound } from '../api.ts'
import type { View } from '../api.ts'
import { coins } from '../format.ts'
import { MINES_H, MINES_W, MinesScene, winCells } from '../game/minesScene.ts'
import type { Win } from '../game/minesScene.ts'
import { dataUrl } from '../game/sprites.ts'
import { sfx } from '../game/sound.ts'
import { wait } from '../game/stage.tsx'
import { GameStage, SlotPanel, useScene, useSlot, useSlotLoop } from '../ui/game.tsx'
import { MinesRules } from '../ui/rules.tsx'
import { PageHead } from '../ui/shell.tsx'

type Pending = { id: number; pot: number; canGamble: boolean; gambles: number }

export default function Mines() {
  const slot = useSlot('mines', 'scatter')
  const { info, bet, busy, setBusy, setNote, setRunning, setError, fail, setBalance, session, banner, auto } = slot
  const { scene, ready, onReady } = useScene(({ app, world }) => new MinesScene(app, world))
  const [bonus, setBonus] = useState<{ n: number; of: number; mult: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [crystal, setCrystal] = useState<{ pick: string; got: string } | null>(null)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  async function play(view: View) {
    const s = scene.current!
    sfx.spin()
    await s.spin(view.grid)
    sfx.stop(2)
    // The server scales every pay by the admin-set RTP; the numbers inside the view are unscaled.
    const k = (view.rtp_scale as number | undefined) ?? 1
    const wins = view.wins as Win[]
    if (wins.length) {
      sfx.win()
      s.highlight(winCells(wins))
      setRunning(Math.round(view.base_win * k))
      setNote(wins.length === 1 ? 'Выигрышная линия' : `Выигрышных линий: ${wins.length}`)
      await wait(950)
    }
    if (view.free_spins) {
      sfx.dynamite()
      setNote('Три динамита! Десять бесплатных спинов.')
      s.highlight(winCells([]))
      await s.bonus({ title: 'БОНУС!', sub: '10 БЕСПЛАТНЫХ СПИНОВ' })
      let total: number = Math.round(view.base_win * k)
      let of = 10
      for (let i = 0; i < view.free_spins.length; i++) {
        const fs = view.free_spins[i]
        setBonus({ n: i + 1, of, mult: fs.multiplier })
        sfx.spin()
        await s.spin(fs.grid, true)
        if (fs.wins.length) {
          sfx.win(Math.min(4, i))
          s.highlight(winCells(fs.wins as Win[]))
          total += Math.round(fs.win * k)
          setRunning(total)
          await wait(800)
        } else {
          await wait(260)
        }
        if (fs.retrigger) {
          // Three dynamite inside the bonus: light them up and add the spins.
          of += fs.retrigger
          const sticks: [number, number][] = []
          fs.grid.forEach((col: string[], r: number) => col.forEach((sym: string, row: number) => sym === 'dynamite' && sticks.push([r, row])))
          sfx.dynamite()
          setNote(`Ещё ${fs.retrigger} бесплатных спинов!`)
          s.highlight(sticks)
          await wait(500)
          await s.bonus({ title: 'ЕЩЁ!', sub: `+${fs.retrigger} СПИНОВ · ×6` })
          s.clearMarks()
          setBonus({ n: i + 1, of, mult: fs.multiplier })
        }
      }
      setBonus(null)
      setRunning(view.total_win)
    }
    else {
      // Two dynamite on the grid: one short of the bonus, tease it.
      const sticks: [number, number][] = []
      view.grid.forEach((col: string[], r: number) => col.forEach((sym: string, row: number) => sym === 'dynamite' && sticks.push([r, row])))
      if (sticks.length === 2) {
        setNote('Два динамита — не хватило одного до бонуса!')
        s.highlight(sticks)
        sfx.lose()
        await wait(700)
      }
    }
    s.clearMarks()
    if (view.capped) setNote(`Достигнут лимит выигрыша — ${info?.max_win_multiplier ?? 100}× ставки.`)
  }

  async function spin(buy = false) {
    slot.setConfirmBuy(false)
    const autoOn = auto.active
    setBusy(true)
    setError('')
    setRunning(null)
    setCrystal(null)
    setPending(null)
    scene.current?.clearMarks()
    try {
      const r = await startRound('mines', bet, slot.roundMode(buy))
      setBalance(r.balance - r.payout)
      setNote(buy ? 'Бонус куплен. Три динамита на поле…' : 'Крутим…')
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
      fail(e)
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
      fail(e, 'Не получилось забрать выигрыш.')
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
      fail(e, 'Не получилось рискнуть.')
    } finally {
      setBusy(false)
    }
  }

  useSlotLoop(slot, ready, () => void spin())

  return (
    <>
      <PageHead title="Шахта" sub="5×3, 20 линий. Кирка — дикий символ, динамит — бонус." />
      <div className="play">
        <GameStage
          width={MINES_W}
          height={MINES_H}
          label="Игровое поле Шахты: пять барабанов по три блока"
          onReady={onReady}
          banner={banner.node}
          badge={bonus ? `Бонус ${bonus.n}/${bonus.of} · множитель ×${bonus.mult}` : null}
          note={slot.note}
          running={slot.running}
        />
        <SlotPanel
          slot={slot}
          ready={ready}
          onSpin={(buy) => void spin(buy)}
          modeTitle="Гарантированный динамит на каждом спине"
          buyHint="Три динамита сразу и 10 бесплатных спинов."
          spinLabel={pending && !busy ? 'Забрать и крутить' : undefined}
          above={
            pending ? (
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
                  <p className="hint">Дальше рисковать нельзя: достигнут предел риска или лимит выигрыша.</p>
                )}
              </section>
            ) : null
          }
        />
      </div>

      <MinesRules />
    </>
  )
}
