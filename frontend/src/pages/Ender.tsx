import { useState } from 'react'
import { startRound } from '../api.ts'
import { coins } from '../format.ts'
import { CREEPER_H, CREEPER_W, CreeperScene, ENDER_SKIN } from '../game/creeperScene.ts'
import type { Cluster } from '../game/creeperScene.ts'
import { sfx } from '../game/sound.ts'
import { wait } from '../game/stage.tsx'
import { GameStage, SlotPanel, useScene, useSlot, useSlotLoop } from '../ui/game.tsx'
import { EnderRules } from '../ui/rules.tsx'
import { PageHead } from '../ui/shell.tsx'

type EnderWave = { grid: string[][]; clusters: Cluster[]; win: number }

type Spin = {
  grid: string[][]
  final_grid: string[][]
  waves: EnderWave[]
  eggs: number[]
  multiplier: number
  scatters: number
  scatter_win: number
  win: number
  retrigger?: number
}

const sameGrid = (a: string[][], b: string[][]) => JSON.stringify(a) === JSON.stringify(b)

export default function Ender() {
  const slot = useSlot('ender', 'ante')
  const { bet, setBusy, setNote, setRunning, setError, fail, setBalance, session, banner, auto } = slot
  const { scene, ready, onReady } = useScene(({ app, world }) => new CreeperScene(app, world, ENDER_SKIN))
  const [wave, setWave] = useState<number | null>(null)
  const [eggMult, setEggMult] = useState<number | null>(null)
  const [bonus, setBonus] = useState<{ n: number; of: number; mult: number } | null>(null)

  /**
   * One spin with all its tumbles. `carried` is what the round has already won, `k` the RTP scale the
   * server applied to every number in the view. Returns the new total.
   */
  async function playSpin(s: CreeperScene, sp: Spin, carried: number, free: boolean, last: boolean, capped: boolean, k: number) {
    sfx.spin()
    await s.dropIn(sp.grid)
    sfx.stop(3)
    let total = 0
    for (let i = 0; i < sp.waves.length; i++) {
      const w = sp.waves[i]
      const isLast = i === sp.waves.length - 1
      const next: string[][] = isLast ? sp.final_grid : sp.waves[i + 1].grid
      setWave(i + 1)
      setNote(
        w.clusters.length === 1 ? `Кластер из ${w.clusters[0].count} блоков` : `Кластеров в тумбле: ${w.clusters.length}`,
      )
      total += Math.round(w.win * k)
      setRunning(carried + total)
      sfx.explode(i)
      // The cap stopped the chain before this wave vanished: show it, do not drop new blocks.
      await s.playWave({ ...w, multiplier: 1 }, capped && last && isLast && sameGrid(next, w.grid) ? w.grid : next, i)
    }
    const mult = sp.multiplier
    if (sp.waves.length > 0 && mult > 1) {
      setEggMult(mult)
      setNote(free ? `Множитель бонуса ×${mult}: выигрыш вращения ${coins(Math.round(sp.win * k))}` : `Драконьи яйца: весь выигрыш ×${mult}`)
      sfx.creeper()
      await s.flashMultipliers()
      await wait(250)
    }
    if (!free && sp.scatter_win > 0) {
      setNote(`Кристаллы Края платят сами: ${coins(Math.round(sp.scatter_win * k))}`)
      sfx.dynamite()
      await s.flashScatters()
    }
    if (!free && last && sp.scatters === 3) {
      // One short of the bonus: tease it.
      setNote('Совсем чуть-чуть: не хватило одного кристалла до бонуса!')
      sfx.lose()
      await s.flashScatters()
      await wait(200)
    }
    setWave(null)
    return carried + Math.round(sp.win * k)
  }

  async function spin(buy = false) {
    slot.setConfirmBuy(false)
    const autoOn = auto.active
    setBusy(true)
    setError('')
    setRunning(null)
    setWave(null)
    setEggMult(null)
    setBonus(null)
    const s = scene.current!
    try {
      const r = await startRound('ender', bet, slot.roundMode(buy))
      const v = r.view
      const k = (v.rtp_scale as number | undefined) ?? 1
      const cost = (v.cost as number | undefined) ?? bet
      setBalance(r.balance - r.payout)
      setNote(buy ? 'Бонус куплен. Кристаллы на поле…' : 'Блоки падают…')
      const capped = Boolean(v.capped)
      const fs = v.free_spins as { awarded: number; spins: Spin[] } | null

      let total = await playSpin(s, v as Spin, 0, false, !fs, capped, k)
      if (fs) {
        sfx.dynamite()
        setNote(`Кристаллы Края! ${fs.awarded} бесплатных вращений.`)
        await s.flashScatters()
        await s.bonus({ title: 'БОНУС!', sub: `${fs.awarded} БЕСПЛАТНЫХ ВРАЩЕНИЙ` })
        s.setFree(true)
        let of = fs.awarded
        let mult = 0
        for (let i = 0; i < fs.spins.length; i++) {
          const sp = fs.spins[i]
          setEggMult(null)
          setNote(`Бонусное вращение ${i + 1}`)
          setBonus({ n: i + 1, of, mult })
          total = await playSpin(s, sp, total, true, i === fs.spins.length - 1, capped, k)
          mult = sp.multiplier
          if (sp.retrigger) {
            of += sp.retrigger
            sfx.dynamite()
            setNote(`Ещё ${sp.retrigger} вращений!`)
            await s.flashScatters()
            await s.bonus({ title: 'ЕЩЁ!', sub: `+${sp.retrigger} ВРАЩЕНИЙ` })
          }
          setBonus({ n: i + 1, of, mult })
          setRunning(total)
        }
        s.setFree(false)
        setBonus(null)
        setEggMult(null)
      }
      setRunning(r.payout > 0 ? r.payout : null)
      setBalance(r.balance)
      if (r.payout === 0) setNote('В этот раз без выигрыша.')
      else if (v.capped) setNote(`Достигнут лимит выигрыша — ${slot.info?.max_win_multiplier ?? 100}× ставки: ${coins(r.payout)}.`)
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
      <PageHead title="Врата Края" sub="6×5. Восемь одинаковых блоков где угодно — тумбл. Драконьи яйца множат выигрыш, четыре кристалла — бесплатные вращения." />
      <div className="play">
        <GameStage
          width={CREEPER_W}
          height={CREEPER_H}
          label="Игровое поле Врат Края: шесть колонок по пять блоков"
          onReady={onReady}
          banner={banner.node}
          badge={
            bonus
              ? `Бесплатные вращения ${bonus.n}/${bonus.of} · множитель ×${Math.max(1, bonus.mult)}`
              : wave
                ? `Тумбл ${wave}${eggMult ? ` · Яйца ×${eggMult}` : ''}`
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
          buyHint="Четыре кристалла сразу и 15 бесплатных вращений."
        />
      </div>

      <EnderRules />
    </>
  )
}
