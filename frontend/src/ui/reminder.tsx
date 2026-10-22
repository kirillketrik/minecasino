import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth.tsx'
import { coins, signed } from '../format.ts'
import { go } from '../route.ts'

export const REMINDER_CHOICES = [0, 15, 30, 60, 120]
const KEY = 'minebet.reminder'

export function getReminder(): number {
  try {
    const v = localStorage.getItem(KEY)
    return v !== null && REMINDER_CHOICES.includes(Number(v)) ? Number(v) : 60
  } catch {
    return 60
  }
}

export function setReminder(minutes: number) {
  try {
    localStorage.setItem(KEY, String(minutes))
  } catch {
    /* not remembered */
  }
  window.dispatchEvent(new Event('minebet:reminder'))
}

/** Every N minutes of one visit: how long the player has been here and where the balance stands. */
export function SessionReminder() {
  const { user } = useAuth()
  const balance = user?.balance ?? 0
  const start = useRef({ at: Date.now(), balance })
  const [due, setDue] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [minutes, setMinutes] = useState(getReminder)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onChange = () => setMinutes(getReminder())
    window.addEventListener('minebet:reminder', onChange)
    return () => window.removeEventListener('minebet:reminder', onChange)
  }, [])

  useEffect(() => {
    if (minutes === 0) return
    const t = setTimeout(() => setDue(true), minutes * 60_000)
    return () => clearTimeout(t)
  }, [minutes, tick])

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (due && !d.open) d.showModal()
    if (!due && d.open) d.close()
  }, [due])

  const mins = Math.max(1, Math.round((Date.now() - start.current.at) / 60_000))
  const net = balance - start.current.balance
  const close = () => {
    setDue(false)
    setTick((n) => n + 1)
  }

  return (
    <dialog ref={dialog} className="reminder" aria-labelledby="rem-title" onClose={close}>
      <h2 id="rem-title">Вы играете уже {mins} мин.</h2>
      <p>
        Баланс с начала сессии: <strong>{signed(net)}</strong> монет (сейчас {coins(balance)}). Сделайте паузу, если игра перестала быть развлечением.
      </p>
      <div className="reminder-actions">
        <button type="button" className="btn btn-primary" onClick={close}>
          Продолжить
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            close()
            go('limits')
          }}
        >
          Лимиты и перерыв
        </button>
      </div>
    </dialog>
  )
}
