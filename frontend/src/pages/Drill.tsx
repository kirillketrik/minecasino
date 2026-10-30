import { useState } from 'react'
import { startRound } from '../api.ts'
import { coins } from '../format.ts'
import { DRILL_H, DRILL_W, DrillScene, TOOL_NAMES } from '../game/drillScene.ts'
import type { DrillChest, DrillStep } from '../game/drillScene.ts'
import { sfx } from '../game/sound.ts'
import { wait } from '../game/stage.tsx'
import { GameStage, SlotPanel, useScene, useSlot, useSlotLoop } from '../ui/game.tsx'
import { DrillRules } from '../ui/rules.tsx'
import { PageHead } from '../ui/shell.tsx'

type DrillView = {
  mine: string[][]
  tools: string[]
  steps: DrillStep[]
  chests: DrillChest[]
  cleared: boolean
  win: number
}

export default function Drill() {
  const slot = useSlot('drill', 'ante')
  const { bet, setBusy, setNote, setRunning, setError, fail, setBalance, session, banner, auto } = slot
  const { scene, ready, onReady } = useScene(({ app, world }) => new DrillScene(app, world))
  const [badge, setBadge] = useState<string | null>(null)

  async function spin() {
    const autoOn = auto.active
    setBusy(true)
    setError('')
    setRunning(null)
    setBadge(null)
    const s = scene.current!
    try {
      const r = await startRound('drill', bet, slot.roundMode(false))
      const v = r.view as unknown as DrillView
      const k = (r.view.rtp_scale as number | undefined) ?? 1
      const cost = (r.view.cost as number | undefined) ?? bet
      setBalance(r.balance - r.payout)
      setNote('Шахта заполняется…')
      sfx.spin()
      await s.deal(v.mine, v.tools)
      sfx.stop(3)
      s.markGrand(v.chests)
      if (v.tools.every((t) => t === 'none')) setNote('Инструменты не выпали.')
      await wait(300)

      let total = 0
      let opened = 0
      for (const step of v.steps) {
        if (step.tool === 'none') continue
        const gained = Math.round(step.win * k)
        setBadge(`Колонка ${step.col + 1}: ${TOOL_NAMES[step.tool] ?? step.tool}`)
        setNote(
          step.broken.length === 0
            ? `${TOOL_NAMES[step.tool] ?? step.tool}: блок не по силам`
            : `${TOOL_NAMES[step.tool] ?? step.tool}: разрушено блоков — ${step.broken.length}`,
        )
        if (step.tool === 'tnt') sfx.dynamite()
        else if (step.broken.length) sfx.explode(opened)
        await s.play(step)
        opened += step.opened.length
        total += gained + step.opened.reduce((sum, c) => sum + Math.round(c.prize * k), 0)
        if (step.opened.length) sfx.dynamite()
        setRunning(total)
      }
      setBadge(null)
      if (v.cleared) setNote('Шахта пройдена до конца: выигрыш ×2!')
      setRunning(r.payout > 0 ? r.payout : null)
      setBalance(r.balance)
      if (r.payout === 0) setNote('В этот раз без выигрыша.')
      else if (r.view.capped) setNote(`Достигнут лимит выигрыша — ${slot.info?.max_win_multiplier ?? 100}× ставки: ${coins(r.payout)}.`)
      else setNote(`Выигрыш ${coins(r.payout)}.`)
      session.spin(cost, r.payout)
      if (r.payout > 0) banner.show(r.payout, bet)
      else sfx.lose()
      if (autoOn) auto.report({ cost, win: r.payout, bet, bonus: v.steps.some((st) => st.opened.length > 0) })
    } catch (e) {
      fail(e)
      setBalance(slot.balance)
      auto.stop('Автоспины остановлены из-за ошибки.')
      setBadge(null)
    } finally {
      setBusy(false)
    }
  }

  useSlotLoop(slot, ready, () => void spin())

  return (
    <>
      <PageHead title="Бурение" sub="5 колонок, 7 слоёв. Кирки и динамит падают сверху и пробиваются к сундукам. Чем глубже, тем ценнее добыча." />
      <div className="play">
        <GameStage
          width={DRILL_W}
          height={DRILL_H}
          label="Шахта: пять колонок по семь блоков, сверху инструменты, снизу сундуки"
          onReady={onReady}
          banner={banner.node}
          badge={badge}
          note={slot.note}
          running={slot.running}
        />
        <SlotPanel
          slot={slot}
          ready={ready}
          onSpin={() => void spin()}
          modeTitle="Больше инструментов"
          buyHint=""
        />
      </div>

      <DrillRules />
    </>
  )
}
