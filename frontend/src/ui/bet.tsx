import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import type { GameInfo } from '../api.ts'
import { coins } from '../format.ts'

let infoCache: Promise<GameInfo[]> | null = null

export function useGameInfo(id: string): GameInfo | null {
  const [info, setInfo] = useState<GameInfo | null>(null)
  useEffect(() => {
    infoCache ??= api<GameInfo[]>('/games')
    let live = true
    infoCache.then((all) => live && setInfo(all.find((g) => g.id === id) ?? null)).catch(() => (infoCache = null))
    return () => {
      live = false
    }
  }, [id])
  return info
}

const clamp = (info: GameInfo, v: number) => {
  const stepped = Math.round(v / info.bet_step) * info.bet_step
  return Math.max(info.min_bet, Math.min(info.max_bet - (info.max_bet % info.bet_step), stepped))
}

export function useBet(id: string, info: GameInfo | null): [number, (v: number) => void] {
  const key = `minebet.bet.${id}`
  const [raw, setRaw] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(key)) || 0
    } catch {
      return 0
    }
  })
  const bet = info ? clamp(info, raw || info.min_bet * 5) : raw
  const set = (v: number) => {
    const next = info ? clamp(info, v) : v
    setRaw(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {
      /* the bet simply is not remembered */
    }
  }
  return [bet, set]
}

type Props = {
  info: GameInfo | null
  bet: number
  setBet: (v: number) => void
  disabled?: boolean
  balance: number
}

export function BetControl({ info, bet, setBet, disabled, balance }: Props) {
  if (!info) return <div className="bet" aria-busy="true" />
  const step = info.bet_step
  const max = Math.min(info.max_bet, Math.floor(balance / step) * step)
  return (
    <div className="bet" role="group" aria-label="Ставка">
      <div className="bet-row">
        <button type="button" className="btn btn-icon" disabled={disabled || bet <= info.min_bet} onClick={() => setBet(bet - step)} aria-label="Уменьшить ставку">
          −
        </button>
        <label className="bet-field">
          <span className="bet-label">Ставка</span>
          <input
            inputMode="numeric"
            value={bet}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''))
              setBet(Number.isFinite(n) ? n : bet)
            }}
            aria-describedby="bet-hint"
          />
        </label>
        <button type="button" className="btn btn-icon" disabled={disabled || bet >= info.max_bet} onClick={() => setBet(bet + step)} aria-label="Увеличить ставку">
          +
        </button>
      </div>
      <div className="bet-quick">
        <button type="button" className="chip" disabled={disabled} onClick={() => setBet(info.min_bet)}>Мин</button>
        <button type="button" className="chip" disabled={disabled} onClick={() => setBet(Math.floor(bet / 2))}>½</button>
        <button type="button" className="chip" disabled={disabled} onClick={() => setBet(bet * 2)}>×2</button>
        <button type="button" className="chip" disabled={disabled || max < info.min_bet} onClick={() => setBet(max)}>Макс</button>
      </div>
      <p id="bet-hint" className="hint">
        От {coins(info.min_bet)} до {coins(info.max_bet)}, шаг {coins(step)}
      </p>
    </div>
  )
}
