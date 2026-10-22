import { useState } from 'react'
import { startRound } from '../api.ts'
import { coins } from '../format.ts'
import { CREEPER_H, CREEPER_W, CreeperScene } from '../game/creeperScene.ts'
import type { Wave } from '../game/creeperScene.ts'
import { sfx } from '../game/sound.ts'
import { wait } from '../game/stage.tsx'
import { GameStage, SlotPanel, useScene, useSlot, useSlotLoop } from '../ui/game.tsx'
import { CreeperRules } from '../ui/rules.tsx'
import { PageHead } from '../ui/shell.tsx'

type Spin = {
  grid: string[][]
  final_grid: string[][]
  waves: Wave[]
  creeper_multiplier: number
  win: number
  scatters: number
  retrigger?: number
}

const sameGrid = (a: string[][], b: string[][]) => JSON.stringify(a) === JSON.stringify(b)

export default function Creeper() {
  const slot = useSlot('creeper', 'ante')
  const { bet, setBusy, setNote, setRunning, setError, fail, setBalance, session, banner, auto } = slot
  const { scene, ready, onReady } = useScene(({ app, world }) => new CreeperScene(app, world))
  const [wave, setWave] = useState<{ n: number; mult: number } | null>(null)
  const [creeperMult, setCreeperMult] = useState<number | null>(null)
  const [bonus, setBonus] = useState<{ n: number; of: number; mult: number } | null>(null)

  /** One spin with all its cascades. `carried` is what the round has already won. Returns the new total. */
  async function playSpin(s: CreeperScene, sp: Spin, carried: number, free: boolean, last: boolean, capped: boolean) {
    sfx.spin()
    await s.dropIn(sp.grid)
    sfx.stop(3)
    let total = 0
    for (let i = 0; i < sp.waves.length; i++) {
      const w = sp.waves[i]
      const isLast = i === sp.waves.length - 1
      const next: string[][] = isLast ? sp.final_grid : sp.waves[i + 1].grid
      setWave({ n: i + 1, mult: w.multiplier })
      setNote(
        w.clusters.length === 1 ? `Кластер из ${w.clusters[0].count} блоков` : `Кластеров в волне: ${w.clusters.length}`,
      )
      total += w.win
      setRunning(carried + total)
      sfx.explode(i)
      // The cap stopped the chain before this wave exploded: show it, do not drop new blocks.
      await s.playWave(w, capped && last && isLast && sameGrid(next, w.grid) ? w.grid : next)
    }
    const mult = sp.creeper_multiplier
    if (sp.waves.length > 0 && mult > 1) {
      setCreeperMult(mult)
      setNote(free ? `Множитель бонуса ×${mult}: выигрыш вращения ${coins(sp.win)}` : `Крипер: весь выигрыш ×${mult}`)
      sfx.creeper()
      await s.flashCreepers()
      await wait(250)
    }
    setWave(null)
    return carried + sp.win
  }

  async function spin(buy = false) {
    slot.setConfirmBuy(false)
    const autoOn = auto.active
    setBusy(true)
    setError('')
    setRunning(null)
    setWave(null)
    setCreeperMult(null)
    setBonus(null)
    const s = scene.current!
    try {
      const r = await startRound('creeper', bet, slot.roundMode(buy))
      const v = r.view
      const cost = (v.cost as number | undefined) ?? bet
      setBalance(r.balance - r.payout)
      setNote(buy ? 'Бонус куплен. Порталы на поле…' : 'Блоки падают…')
      const capped = Boolean(v.capped)
      const fs = v.free_spins as { awarded: number; spins: Spin[] } | null

      let total = await playSpin(s, v as Spin, 0, false, !fs, capped)
      if (fs) {
        sfx.dynamite()
        setNote(`Порталы! ${fs.awarded} бесплатных вращений.`)
        await s.flashScatters()
        await wait(900)
        s.setFree(true)
        let of = fs.awarded
        let mult = 0
        for (let i = 0; i < fs.spins.length; i++) {
          const sp = fs.spins[i]
          setCreeperMult(null)
          setNote(`Бонусное вращение ${i + 1}`)
          setBonus({ n: i + 1, of, mult })
          total = await playSpin(s, sp, total, true, i === fs.spins.length - 1, capped)
          mult = sp.creeper_multiplier
          if (sp.retrigger) {
            of += sp.retrigger
            sfx.dynamite()
            setNote(`Ещё ${sp.retrigger} вращений!`)
            await s.flashScatters()
          }
          setBonus({ n: i + 1, of, mult })
          setRunning(total)
        }
        s.setFree(false)
        setBonus(null)
        setCreeperMult(null)
      }
      setRunning(r.payout > 0 ? r.payout : null)
      setBalance(r.balance)
      if (r.payout === 0) setNote('В этот раз без выигрыша.')
      else if (v.capped) setNote(`Достигнут лимит выигрыша — 100× ставки: ${coins(r.payout)}.`)
      else setNote(`Выигрыш ${coins(r.payout)}.`)
      session.spin(cost, r.payout)
      if (r.payout > 0) banner.show(r.payout, bet)
      else sfx.lose()
      if (autoOn) auto.report({ cost, win: r.payout, bet, bonus: Boolean(fs) })
    } catch (e) {
      fail(e)
      setBalance(slot.balance)
      auto.stop('Автоспины остановлены из-за ошибки.')
      scene.current?.setFree(false)
      setBonus(null)
    } finally {
      setBusy(false)
    }
  }

  useSlotLoop(slot, ready, () => void spin())

  return (
    <>
      <PageHead title="Крипер" sub="6×5. Восемь одинаковых блоков где угодно — взрыв и каскад. Четыре портала — бесплатные вращения." />
      <div className="play">
        <GameStage
          width={CREEPER_W}
          height={CREEPER_H}
          label="Игровое поле Крипера: шесть колонок по пять блоков"
          onReady={onReady}
          banner={banner.node}
          badge={
            bonus
              ? `Бесплатные вращения ${bonus.n}/${bonus.of} · множитель ×${Math.max(1, bonus.mult)}`
              : wave
                ? `Волна ${wave.n} · ×${wave.mult}${creeperMult ? ` · Крипер ×${creeperMult}` : ''}`
                : null
          }
          note={slot.note}
          running={slot.running}
        />
        <SlotPanel
          slot={slot}
          ready={ready}
          onSpin={(buy) => void spin(buy)}
          modeTitle="Повышенный шанс бонуса"
          buyHint="Четыре портала сразу и от 10 бесплатных вращений."
        />
      </div>

      <CreeperRules />
    </>
  )
}
