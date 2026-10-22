import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api.ts'
import type { Limits as LimitsData } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { coins, when } from '../format.ts'
import { REMINDER_CHOICES, getReminder, setReminder } from '../ui/reminder.tsx'
import { PageHead } from '../ui/shell.tsx'

const HOURS: Record<number, string> = { 1: '1 час', 24: '24 часа', 168: '7 дней', 720: '30 дней', 4320: '180 дней' }

const asNumber = (v: string) => Number(v.replace(/\D/g, '')) || 0

export default function Limits() {
  const { refresh } = useAuth()
  const [data, setData] = useState<LimitsData | null>(null)
  const [dep, setDep] = useState(0)
  const [loss, setLoss] = useState(0)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [reminder, setReminderState] = useState(getReminder)

  const load = useCallback(async () => {
    const d = await api<LimitsData>('/limits')
    setData(d)
    setDep(d.deposit_limit ?? 0)
    setLoss(d.loss_limit ?? 0)
  }, [])
  useEffect(() => {
    void load().catch(() => setMsg({ ok: false, text: 'Не получилось загрузить лимиты.' }))
  }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    try {
      const d = await api<LimitsData>('/limits', {
        method: 'PUT',
        body: { deposit_limit: dep || null, loss_limit: loss || null },
      })
      setData(d)
      setMsg({ ok: true, text: 'Лимиты сохранены.' })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Не получилось сохранить.' })
    }
  }

  async function exclude(hours: number) {
    setMsg(null)
    try {
      setData(await api<LimitsData>('/limits/exclusion', { body: { hours } }))
      setConfirm(null)
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Не получилось включить блокировку.' })
    }
  }

  const left = (limit: number | null, used: number) =>
    limit === null ? 'без лимита' : `осталось ${coins(Math.max(0, limit - used))} из ${coins(limit)}`

  return (
    <>
      <PageHead title="Ответственная игра" sub="Лимиты, перерывы и блокировка. Играйте только на то, что готовы потерять." />

      {data?.excluded_until ? (
        <p className="notice" role="status">
          Игра и пополнение заблокированы до {when(data.excluded_until)}. Вывод монет остаётся доступным. Досрочно снять блокировку нельзя.
        </p>
      ) : null}

      <div className="wallet-grid">
        <form className="panel" onSubmit={save}>
          <h2>Лимиты за 24 часа</h2>
          <p className="hint">Считаются за последние сутки. 0 — лимита нет.</p>
          <label className="field">
            <span>Пополнение, монет</span>
            <input inputMode="numeric" value={dep} onChange={(e) => setDep(asNumber(e.target.value))} />
            <small>Сейчас: {data ? left(data.deposit_limit, data.deposited_24h) : '…'}</small>
          </label>
          <label className="field">
            <span>Проигрыш, монет</span>
            <input inputMode="numeric" value={loss} onChange={(e) => setLoss(asNumber(e.target.value))} />
            <small>
              Ставка, из-за которой чистый проигрыш за сутки превысит лимит, не примется. Сейчас: {data ? left(data.loss_limit, data.lost_24h) : '…'}
            </small>
          </label>
          <button type="submit" className="btn btn-primary" disabled={!data}>
            Сохранить лимиты
          </button>
        </form>

        <section className="panel" aria-labelledby="remind">
          <h2 id="remind">Напоминания о времени</h2>
          <p className="hint">Окно с временем сессии и результатом появится через выбранный интервал.</p>
          <div className="seg" role="group" aria-label="Интервал напоминаний">
            {REMINDER_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={reminder === m}
                onClick={() => {
                  setReminder(m)
                  setReminderState(m)
                }}
              >
                {m === 0 ? 'Выкл' : `${m} мин`}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="excl">
          <h2 id="excl">Самоисключение</h2>
          <p className="hint">Блокирует игру и пополнение на выбранный срок. Блокировку нельзя снять раньше, но можно продлить.</p>
          <div className="seg" role="group" aria-label="Срок блокировки">
            {(data?.exclusion_hours ?? Object.keys(HOURS).map(Number)).map((h) => (
              <button key={h} type="button" className="chip" aria-pressed={confirm === h} onClick={() => setConfirm(h)}>
                {HOURS[h] ?? `${h} ч`}
              </button>
            ))}
          </div>
          {confirm !== null ? (
            <div className="confirm">
              <p>Заблокировать игру и пополнение на {HOURS[confirm]}? Отменить это нельзя.</p>
              <button type="button" className="btn btn-danger" onClick={() => void exclude(confirm)}>
                Да, заблокировать
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Отмена
              </button>
            </div>
          ) : null}
        </section>
      </div>
      {msg ? (
        <p className={msg.ok ? 'note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      ) : null}
    </>
  )
}
