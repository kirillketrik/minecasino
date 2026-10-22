import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api.ts'
import type { AdminConfig, GameConfig, RuntimeConfig } from '../api.ts'
import { coins } from '../format.ts'
import { PageHead } from '../ui/shell.tsx'
import { TIER_NAMES, setThresholds } from '../ui/win.tsx'

const GAMES: Record<string, string> = { mines: 'Шахта', creeper: 'Крипер', elytra: 'Элитры' }
const MODES: Record<string, string> = {
  scatter: 'Гарантированный динамит',
  ante: 'Повышенный шанс бонуса',
  buy_bonus: 'Покупка бонуса',
}

const asNumber = (v: string) => Number(v.replace(/\D/g, '')) || 0

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

  const game = (id: string): GameConfig => games[id] ?? { disabled_modes: [], max_bet: null }
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
      <PageHead title="Админка" sub="Пороги баннеров выигрыша, режимы и максимальная ставка. Математика игр и RTP здесь не меняются." />
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
