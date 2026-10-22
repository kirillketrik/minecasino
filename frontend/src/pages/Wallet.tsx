import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api.ts'
import type { Tx, Withdrawal } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { coins, signed, when } from '../format.ts'
import { PageHead } from '../ui/shell.tsx'

export const KIND_LABEL: Record<Tx['kind'], string> = {
  signup_bonus: 'Бонус за регистрацию',
  deposit: 'Пополнение (тест)',
  withdrawal: 'Вывод на сервер',
  withdrawal_refund: 'Возврат вывода',
  bet: 'Ставка',
  win: 'Выигрыш',
}

const STATUS: Record<Withdrawal['status'], string> = {
  pending: 'Ожидает',
  completed: 'Выполнен',
  rejected: 'Отклонён',
}
const SERVER: Record<Withdrawal['server'], string> = { funtime: 'FunTime', holyworld: 'HolyWorld LITE' }

export default function Wallet() {
  const { user, refresh } = useAuth()
  const [txs, setTxs] = useState<Tx[] | null>(null)
  const [wds, setWds] = useState<Withdrawal[]>([])
  const [amount, setAmount] = useState(1000)
  const [wdAmount, setWdAmount] = useState(100)
  const [server, setServer] = useState<Withdrawal['server']>('funtime')
  const [depMsg, setDepMsg] = useState('')
  const [wdMsg, setWdMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [t, w] = await Promise.all([api<Tx[]>('/wallet/transactions?limit=30'), api<Withdrawal[]>('/wallet/withdrawals')])
    setTxs(t)
    setWds(w)
  }, [])
  useEffect(() => {
    void load().catch(() => setTxs([]))
  }, [load])

  async function deposit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setDepMsg('')
    try {
      await api<Tx>('/wallet/deposit', { body: { amount } })
      await Promise.all([refresh(), load()])
      setDepMsg(`Зачислено ${coins(amount)} монет.`)
    } catch (err) {
      setDepMsg(err instanceof ApiError ? err.message : 'Не получилось пополнить.')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setWdMsg(null)
    try {
      await api<Withdrawal>('/wallet/withdrawals', { body: { amount: wdAmount, server } })
      await Promise.all([refresh(), load()])
      setWdMsg({ ok: true, text: `Заявка на ${coins(wdAmount)} монет создана. Выплата на сервер пока не подключена.` })
    } catch (err) {
      setWdMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Не получилось создать заявку.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title="Кошелёк" sub="1 рубль = 1 монета. Платёжный шлюз пока тестовый: монеты начисляются без оплаты." />
      <div className="wallet-grid">
        <form className="panel" onSubmit={deposit}>
          <h2>Пополнить</h2>
          <div className="bet-quick">
            {[500, 1000, 5000, 10000].map((v) => (
              <button type="button" key={v} className="chip" aria-pressed={amount === v} onClick={() => setAmount(v)}>
                {coins(v)}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Сумма, монет</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || amount <= 0}>
            Получить {coins(amount)} тестовых монет
          </button>
          {depMsg ? <p className="note" role="status">{depMsg}</p> : null}
        </form>

        <form className="panel" onSubmit={withdraw}>
          <h2>Вывести на сервер</h2>
          <p className="hint">
            Монеты придут на ник <strong>{user?.mc_nick}</strong>. Ник не проверяется, выплата пока записывается как заявка.
          </p>
          <label className="field">
            <span>Сервер</span>
            <select value={server} onChange={(e) => setServer(e.target.value as Withdrawal['server'])}>
              <option value="funtime">FunTime</option>
              <option value="holyworld">HolyWorld LITE</option>
            </select>
          </label>
          <label className="field">
            <span>Сумма, монет (от 100)</span>
            <input inputMode="numeric" value={wdAmount} onChange={(e) => setWdAmount(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </label>
          <button type="submit" className="btn" disabled={busy || wdAmount <= 0}>
            Создать заявку
          </button>
          {wdMsg ? (
            <p className={wdMsg.ok ? 'note' : 'form-error'} role={wdMsg.ok ? 'status' : 'alert'}>
              {wdMsg.text}
            </p>
          ) : null}
        </form>
      </div>

      <section className="panel table-panel" aria-labelledby="wd-title">
        <h2 id="wd-title">Заявки на вывод</h2>
        {wds.length === 0 ? (
          <p className="empty">Заявок пока нет.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сервер</th>
                <th>Ник</th>
                <th className="num">Монет</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {wds.map((w) => (
                <tr key={w.id}>
                  <td>{when(w.created_at)}</td>
                  <td>{SERVER[w.server]}</td>
                  <td>{w.mc_nick}</td>
                  <td className="num">{coins(w.amount)}</td>
                  <td>{STATUS[w.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel table-panel" aria-labelledby="tx-title">
        <h2 id="tx-title">Движение монет</h2>
        {txs === null ? (
          <p className="empty">Загрузка…</p>
        ) : txs.length === 0 ? (
          <p className="empty">Операций пока нет.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Операция</th>
                <th className="num">Изменение</th>
                <th className="num">Баланс после</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>{when(t.created_at)}</td>
                  <td>{KIND_LABEL[t.kind]}</td>
                  <td className={`num ${t.amount > 0 ? 'plus' : ''}`}>{signed(t.amount)}</td>
                  <td className="num">{coins(t.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
