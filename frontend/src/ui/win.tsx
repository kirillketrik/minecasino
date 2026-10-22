import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { coins } from '../format.ts'
import { sfx } from '../game/sound.ts'
import { speedFactor } from '../game/speed.ts'

export type Tier = { id: number; name: string; from: number }

export const TIER_NAMES = ['Хороший выигрыш', 'Крупный выигрыш', 'Огромный выигрыш', 'Мега выигрыш', 'Максимальный выигрыш']

// A win is judged by how many bets it is worth. The thresholds are set by the admin; these are the
// defaults used until the server's answer arrives.
export const DEFAULT_THRESHOLDS = [10, 20, 40, 70, 100]
let thresholds = DEFAULT_THRESHOLDS
let loading: Promise<void> | null = null

export const getTiers = (): Tier[] => TIER_NAMES.map((name, i) => ({ id: i + 1, name, from: thresholds[i] }))

export function setThresholds(next: number[]) {
  thresholds = next
}

function loadThresholds() {
  loading ??= api<{ win_tiers: number[] }>('/config')
    .then((c) => setThresholds(c.win_tiers))
    .catch(() => {
      loading = null
    })
  return loading
}

export function tierOf(win: number, bet: number): Tier | null {
  if (bet <= 0) return null
  const ratio = win / bet
  let found: Tier | null = null
  for (const t of getTiers()) if (ratio >= t.from) found = t
  return found
}

type Shown = { tier: Tier; win: number; bet: number; key: number }

export function useWinBanner() {
  const [shown, setShown] = useState<Shown | null>(null)
  const key = useRef(0)
  useEffect(() => {
    void loadThresholds()
  }, [])
  const show = useCallback((win: number, bet: number) => {
    const tier = tierOf(win, bet)
    if (!tier) return false
    sfx.fanfare(tier.id)
    setShown({ tier, win, bet, key: ++key.current })
    return true
  }, [])
  const close = useCallback(() => setShown(null), [])
  const node = shown ? <WinBanner key={shown.key} tier={shown.tier} win={shown.win} bet={shown.bet} onClose={close} /> : null
  return { show, node }
}

function WinBanner({ tier, win, bet, onClose }: Omit<Shown, 'key'> & { onClose: () => void }) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scaled = reduce ? 0 : (900 + tier.id * 300) * speedFactor()
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const p = scaled === 0 ? 1 : Math.min(1, (now - t0) / scaled)
      setValue(Math.round(win * (1 - (1 - p) ** 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    const close = setTimeout(onClose, (2600 + tier.id * 500) * Math.max(0.4, speedFactor()))
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(close)
    }
  }, [tier, win, onClose])

  const ratio = win / bet
  return (
    <button type="button" className={`win-banner tier-${tier.id}`} onClick={onClose} aria-label={`${tier.name}: ${coins(win)}. Закрыть`}>
      <span className="win-banner-tier" role="status">{tier.name}</span>
      <span className="win-banner-sum">{coins(value)}</span>
      <span className="win-banner-x">×{ratio.toFixed(ratio >= 10 ? 0 : 1)} от ставки</span>
    </button>
  )
}
