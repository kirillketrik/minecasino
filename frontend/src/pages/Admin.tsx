import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api.ts'
import type { AdminConfig, AdminGame, GameConfig, RuntimeConfig, Simulation } from '../api.ts'
import { coins } from '../format.ts'
import { PageHead } from '../ui/shell.tsx'
import { TIER_NAMES, setThresholds } from '../ui/win.tsx'

const GAMES: Record<string, string> = { mines: 'Шахта', creeper: 'Крипер', ender: 'Врата Края', drill: 'Бурение', elytra: 'Элитры' }
const MODES: Record<string, string> = {
  scatter: 'Гарантированный динамит',
  ante: 'Повышенный шанс бонуса',
  buy_bonus: 'Покупка бонуса',
}

const asNumber = (v: string) => Number(v.replace(/\D/g, '')) || 0
/** "92,5" -> 0.925; empty or unreadable -> null (keep the calibrated game). */
const asRtp = (v: string) => {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n / 100 : null
}
const percent = (rtp: number | null) => (rtp === null ? '' : String(Math.round(rtp * 10000) / 100))

/** RTP and win cap of one slot, with a way to see what the setting really returns. */
function Tuning({ g, config, patch }: { g: AdminGame; config: GameConfig; patch: (change: Partial<GameConfig>) => void }) {
  const [sim, setSim] = useState<Simulation | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // The text being typed; the stored value is the number it parses to.
  const [rtpText, setRtpText] = useState(percent(config.rtp))

  async function measure() {
    setBusy(true)
    setErr('')
    try {
      setSim(
        await api<Simulation>('/admin/simulate', {
          method: 'POST',
          body: { game_id: g.id, rtp: config.rtp, max_win: config.max_win, rounds: 20000 },
        }),
      )
    } catch (e) {
      setSim(null)
      setErr(e instanceof ApiError ? e.message : 'Не получилось замерить.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <label className="field">
        <span>
          RTP, % (пусто — {Math.round(g.default_rtp * 10000) / 100}); от {g.min_rtp * 100} до {g.max_rtp * 100}
        </span>
        <input
          inputMode="decimal"
          value={rtpText}
          onChange={(e) => {
            setRtpText(e.target.value)
            patch({ rtp: asRtp(e.target.value) })
          }}
        />
      </label>
      <label className="field">
        <span>
          Максимальный выигрыш, × ставки (пусто — {g.default_max_win}); от {g.min_max_win} до {g.max_max_win}
        </span>
        <input
          inputMode="numeric"
          value={config.max_win ?? ''}
          onChange={(e) => patch({ max_win: asNumber(e.target.value) || null })}
        />
      </label>
      <button type="button" className="btn" onClick={() => void measure()} disabled={busy}>
        {busy ? 'Считаю…' : 'Замерить 20 000 вращений'}
      </button>
      {sim ? (
        <p className="note" role="status">
          Факт: RTP {(sim.rtp * 100).toFixed(1)}% ± {(sim.stderr * 100).toFixed(1)}, выигрышей {(sim.hit_rate * 100).toFixed(0)}% вращений,
          максимум ×{sim.max_multiplier.toFixed(0)}.
        </p>
      ) : null}
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      <p className="hint">
        RTP — множитель на все выплаты, лимит выигрыша слегка сдвигает итог, поэтому после изменения лучше замерить.
        Замер идёт по ещё не сохранённым значениям.
      </p>
    </>
  )
}

export default function Admin() {
  const [data, setData] = useState<AdminConfig | null>(null)
  const [tiers, setTiers] = useState<number[]>([])
  const [games, setGames] = useState<Record<string, GameConfig>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api<AdminConfig>('/admin/config')
      .then((d) => {
        setData(d)
        setTiers(d.config.win_tiers)
        setGames(d.config.games)
      })
      .catch((e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Не получилось загрузить настройки.' }))
  }, [])

  const game = (id: string): GameConfig => games[id] ?? { disabled_modes: [], max_bet: null, rtp: null, max_win: null }
  const patch = (id: string, change: Partial<GameConfig>) => setGames((g) => ({ ...g, [id]: { ...game(id), ...change } }))

  async function save(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const body: RuntimeConfig = { win_tiers: tiers, games }
    try {
      const d = await api<AdminConfig>('/admin/config', { method: 'PUT', body })
      setData(d)
      setThresholds(d.config.win_tiers)
      setMsg({ ok: true, text: 'Настройки сохранены. Они применяются сразу.' })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Не получилось сохранить.' })
    }
  }

  return (
    <>
      <PageHead title="Админка" sub="Пороги баннеров выигрыша, режимы, максимальная ставка, а для слотов — RTP и максимальный выигрыш." />
      {data ? (
        <form onSubmit={save}>
          <div className="wallet-grid">
            <section className="panel" aria-labelledby="tiers">
              <h2 id="tiers">Пороги баннеров</h2>
              <p className="hint">Во сколько ставок должен обойтись выигрыш. Каждый порог больше предыдущего, не выше 100.</p>
              {TIER_NAMES.map((name, i) => (
                <label className="field" key={name}>
                  <span>{name}, от × ставки</span>
                  <input
                    inputMode="numeric"
                    value={tiers[i] ?? ''}
                    onChange={(e) => setTiers((t) => t.map((v, j) => (j === i ? asNumber(e.target.value) : v)))}
                  />
                </label>
              ))}
            </section>

            {data.games.map((g) => (
              <section className="panel" key={g.id} aria-labelledby={`g-${g.id}`}>
                <h2 id={`g-${g.id}`}>{GAMES[g.id] ?? g.id}</h2>
                <label className="field">
                  <span>Максимальная ставка (пусто — {coins(g.max_bet)})</span>
                  <input
                    inputMode="numeric"
                    value={game(g.id).max_bet ?? ''}
                    onChange={(e) => patch(g.id, { max_bet: asNumber(e.target.value) || null })}
                  />
                </label>
                {g.modes.length ? (
                  <fieldset className="modes">
                    <legend className="hint">Включённые режимы</legend>
                    {g.modes.map((m) => (
                      <label className="check" key={m}>
                        <input
                          type="checkbox"
                          checked={!game(g.id).disabled_modes.includes(m)}
                          onChange={(e) =>
                            patch(g.id, {
                              disabled_modes: e.target.checked
                                ? game(g.id).disabled_modes.filter((x) => x !== m)
                                : [...game(g.id).disabled_modes, m],
                            })
                          }
                        />
                        <span>{MODES[m] ?? m}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="hint">У этой игры нет дополнительных режимов.</p>
                )}
                {g.tunable ? <Tuning g={g} config={game(g.id)} patch={(change) => patch(g.id, change)} /> : null}
              </section>
            ))}
          </div>
          <button type="submit" className="btn btn-primary">
            Сохранить настройки
          </button>
        </form>
      ) : null}
      {msg ? (
        <p className={msg.ok ? 'note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      ) : null}
    </>
  )
}
