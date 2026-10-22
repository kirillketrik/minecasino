import { useEffect, useState } from 'react'
import { recentRounds } from '../api.ts'
import type { RoundOut } from '../api.ts'
import { coins, signed, when } from '../format.ts'
import { PageHead } from '../ui/shell.tsx'

const NAME: Record<string, string> = { mines: 'Шахта', creeper: 'Крипер', elytra: 'Элитры' }

const spent = (r: RoundOut): number => r.view.cost ?? r.bet

function outcome(r: RoundOut): string {
  if (!r.finished) return 'Не завершён'
  const tag = r.view.mode === 'buy_bonus' ? 'Бонус куплен · ' : r.view.mode === 'scatter' ? 'Со скаттером · ' : ''
  return tag + plainOutcome(r)
}

function plainOutcome(r: RoundOut): string {
  if (r.view.capped) return 'Лимит 100×'
  if (r.view.auto_collected) return 'Забран автоматически'
  if (r.view.lost) return 'Риск не удался'
  if (r.view.status === 'crashed') return 'Элитры сломались'
  if (r.view.status === 'cashed_out') return `Вывод на ${(r.view.cashout / 100).toFixed(2)}×`
  return r.payout > 0 ? 'Выигрыш' : 'Без выигрыша'
}

export default function History() {
  const [rounds, setRounds] = useState<RoundOut[] | null>(null)
  const [more, setMore] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    recentRounds(30)
      .then((r) => {
        setRounds(r)
        setMore(r.length === 30)
      })
      .catch(() => setError('Не получилось загрузить историю.'))
  }, [])

  async function loadMore() {
    if (!rounds?.length) return
    const next = await recentRounds(30, rounds[rounds.length - 1].id)
    setRounds([...rounds, ...next])
    setMore(next.length === 30)
  }

  return (
    <>
      <PageHead title="История" sub="Все ваши раунды: ставка, выигрыш и итог." />
      <section className="panel table-panel">
        {error ? (
          <p className="form-error" role="alert">{error}</p>
        ) : rounds === null ? (
          <p className="empty">Загрузка…</p>
        ) : rounds.length === 0 ? (
          <p className="empty">Вы ещё не играли. Начните с Шахты.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Игра</th>
                <th className="num">Ставка</th>
                <th className="num">Выигрыш</th>
                <th className="num">Итог</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.created_at)}</td>
                  <td>{NAME[r.game_id] ?? r.game_id}</td>
                  <td className="num">{coins(spent(r))}</td>
                  <td className="num">{r.finished ? coins(r.payout) : '—'}</td>
                  <td className={`num ${r.payout > spent(r) ? 'plus' : ''}`}>{r.finished ? signed(r.payout - spent(r)) : '—'}</td>
                  <td>{outcome(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {more && rounds?.length ? (
          <button type="button" className="btn" onClick={() => void loadMore()}>
            Показать ещё
          </button>
        ) : null}
      </section>
    </>
  )
}
