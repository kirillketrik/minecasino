const TOKEN_KEY = 'minebet.token'

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* storage blocked: the session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* nothing to clear */
    }
  },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const RU_ERRORS: Record<string, string> = {
  'Insufficient funds': 'Не хватает монет на балансе.',
  'Invalid email or password': 'Неверная почта или пароль.',
  'Email already registered': 'Эта почта уже зарегистрирована.',
  'Age confirmation (18+) required': 'Нужно подтвердить, что вам есть 18 лет.',
  'Round already finished': 'Раунд уже завершён.',
  'Too early to cash out': 'Слишком рано: вывод доступен от 1.01×.',
  'Not authenticated': 'Войдите в аккаунт.',
  'Admins only': 'Раздел только для администраторов.',
}

function detailText(detail: unknown, status: number): string {
  if (typeof detail === 'string') {
    if (RU_ERRORS[detail]) return RU_ERRORS[detail]
    const bet = /^Bet must be between (\d+) and (\d+)$/.exec(detail)
    if (bet) return `Ставка — от ${bet[1]} до ${bet[2]} монет.`
    const step = /^Bet must be a multiple of (\d+)$/.exec(detail)
    if (step) return `Ставка должна быть кратна ${step[1]}.`
    const until = /^Self-excluded until (.+)$/.exec(detail)
    if (until) return `Игра заблокирована по вашему запросу до ${new Date(until[1]).toLocaleString('ru-RU')}.`
    const lossLim = /^Loss limit reached: (\d+) left$/.exec(detail)
    if (lossLim) return `Лимит проигрыша за 24 часа: осталось ${lossLim[1]} монет. Изменить лимит можно в разделе «Лимиты».`
    const depLim = /^Deposit limit reached: (\d+) left$/.exec(detail)
    if (depLim) return `Лимит пополнения за 24 часа: осталось ${depLim[1]} монет.`
    const off = /^Mode '(.+)' is switched off$/.exec(detail)
    if (off) return 'Этот режим сейчас отключён.'
    const minWd = /^Minimum withdrawal is (\d+)$/.exec(detail)
    if (minWd) return `Минимальный вывод — ${minWd[1]} монет.`
    return detail
  }
  if (Array.isArray(detail)) return 'Проверьте заполнение полей.'
  return status >= 500 ? 'Сервер недоступен. Попробуйте ещё раз.' : 'Не получилось выполнить запрос.'
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get()
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет.')
  }
  if (!response.ok) {
    let detail: unknown
    try {
      detail = (await response.json()).detail
    } catch {
      detail = undefined
    }
    throw new ApiError(response.status, detailText(detail, response.status))
  }
  return (await response.json()) as T
}

export type User = { id: number; email: string; mc_nick: string; balance: number; created_at: string; excluded_until: string | null; is_admin: boolean }

export type GameConfig = { disabled_modes: string[]; max_bet: number | null; rtp: number | null; max_win: number | null }
export type RuntimeConfig = { win_tiers: number[]; games: Record<string, GameConfig> }
export type AdminGame = {
  id: string
  modes: string[]
  max_bet: number
  /** Slots only: RTP and win cap can be set. */
  tunable: boolean
  default_rtp: number
  default_max_win: number
  min_rtp: number
  max_rtp: number
  min_max_win: number
  max_max_win: number
}
export type AdminConfig = { config: RuntimeConfig; games: AdminGame[] }
export type Simulation = { rounds: number; rtp: number; stderr: number; hit_rate: number; max_multiplier: number; capped_rounds: number }

export type Limits = {
  deposit_limit: number | null
  loss_limit: number | null
  deposited_24h: number
  lost_24h: number
  excluded_until: string | null
  exclusion_hours: number[]
}

export type GameInfo = {
  id: string
  min_bet: number
  max_bet: number
  bet_step: number
  max_win_multiplier: number
  /** What the game returns to players in the long run (0.96 = 96%). */
  rtp: number
  /** Play modes: id -> price in 1/20 of the bet. */
  modes: Record<string, number>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type View = Record<string, any>

export type RoundOut = {
  id: number
  game_id: string
  bet: number
  payout: number
  finished: boolean
  view: View
  created_at: string
  balance: number
}

export type Tx = {
  id: number
  kind: 'signup_bonus' | 'deposit' | 'withdrawal' | 'withdrawal_refund' | 'bet' | 'win'
  amount: number
  balance_after: number
  ref: string | null
  created_at: string
}

export type Withdrawal = {
  id: number
  amount: number
  mc_nick: string
  server: 'funtime' | 'holyworld'
  status: 'pending' | 'completed' | 'rejected'
  created_at: string
}

export const startRound = (game: string, bet: number, mode?: string) =>
  api<RoundOut>(`/games/${game}/rounds`, { body: mode ? { bet, mode } : { bet } })

export const roundAction = (id: number, action: Record<string, unknown>) =>
  api<RoundOut>(`/rounds/${id}/actions`, { body: { action } })

export const recentRounds = (limit = 50, beforeId?: number) =>
  api<RoundOut[]>(`/rounds?limit=${limit}${beforeId ? `&before_id=${beforeId}` : ''}`)

export function flightSocket(roundId: number): WebSocket {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return new WebSocket(`${scheme}://${location.host}/api/ws/rounds/${roundId}`)
}
