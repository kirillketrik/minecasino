import { useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api.ts'
import { useAuth } from '../auth.tsx'
import { dataUrl } from '../game/sprites.ts'
import type { SpriteName } from '../game/sprites.ts'
import { go } from '../route.ts'
import { Mark } from '../ui/shell.tsx'

const WALL: SpriteName[][] = [
  ['stone', 'coal', 'stone', 'iron', 'stone', 'stone'],
  ['gold', 'stone', 'stone', 'stone', 'diamond', 'stone'],
  ['stone', 'stone', 'redstone', 'stone', 'stone', 'emerald'],
  ['coal', 'stone', 'stone', 'lapis', 'stone', 'stone'],
]

export default function Auth({ mode }: { mode: 'login' | 'register' }) {
  const { signIn } = useAuth()
  const register = mode === 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nick, setNick] = useState('')
  const [adult, setAdult] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (register && !adult) {
      setError('Подтвердите, что вам есть 18 лет.')
      return
    }
    setBusy(true)
    try {
      const body = register ? { email, password, mc_nick: nick, age_confirmed: adult } : { email, password }
      const out = await api<{ access_token: string }>(register ? '/auth/register' : '/auth/login', { body })
      await signIn(out.access_token)
      go('lobby')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Что-то пошло не так.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-art" aria-hidden="true">
        <div className="wall">
          {WALL.flat().map((name, i) => (
            <img key={i} src={dataUrl(name, 8)} alt="" />
          ))}
        </div>
      </section>
      <section className="auth-form">
        <a className="brand" href="#/login" aria-label="MineBet">
          <Mark />
          <span className="wordmark">MineBet</span>
        </a>
        <h1>{register ? 'Создать аккаунт' : 'Войти'}</h1>
        <p className="sub">
          {register
            ? 'Ставки — в монетах серверов, выигрыш уходит на ваш ник. Только для совершеннолетних.'
            : 'С возвращением. Монеты и история игр ждут вас.'}
        </p>
        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>Почта</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={register ? 8 : undefined}
              required
            />
            {register ? <small>Не короче 8 символов.</small> : null}
          </label>
          {register ? (
            <>
              <label className="field">
                <span>Ник в Minecraft</span>
                <input value={nick} onChange={(e) => setNick(e.target.value)} autoComplete="username" pattern="[A-Za-z0-9_]{3,16}" required />
                <small>3–16 символов: латиница, цифры, «_». Ник пока не проверяется.</small>
              </label>
              <label className="check">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                <span>Мне исполнилось 18 лет, я принимаю правила и понимаю, что игра на монеты — это риск их потерять.</span>
              </label>
            </>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
            {busy ? 'Секунду…' : register ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        <p className="switch">
          {register ? 'Уже есть аккаунт?' : 'Впервые здесь?'}{' '}
          <a href={register ? '#/login' : '#/register'}>{register ? 'Войти' : 'Создать аккаунт'}</a>
        </p>
      </section>
    </div>
  )
}
