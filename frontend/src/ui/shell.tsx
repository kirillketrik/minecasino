import type { ReactNode } from 'react'
import { useAuth } from '../auth.tsx'
import { coins, when } from '../format.ts'
import { go } from '../route.ts'
import { SessionReminder } from './reminder.tsx'
import type { Route } from '../route.ts'
import { dataUrl } from '../game/sprites.ts'
import type { SpriteName } from '../game/sprites.ts'

const NAV: { route: Route; label: string; icon: SpriteName }[] = [
  { route: 'lobby', label: 'Игры', icon: 'stone' },
  { route: 'mines', label: 'Шахта', icon: 'pickaxe' },
  { route: 'creeper', label: 'Крипер', icon: 'creeper' },
  { route: 'elytra', label: 'Элитры', icon: 'elytra' },
  { route: 'wallet', label: 'Кошелёк', icon: 'gold' },
  { route: 'history', label: 'История', icon: 'dynamite' },
  { route: 'limits', label: 'Лимиты', icon: 'stone' },
]

const ADMIN_NAV: (typeof NAV)[number] = { route: 'admin', label: 'Админка', icon: 'redstone' }

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M8 1h2v2h2v2h2v2h-2v2h-2v2H8v2H6v-2H4V9H2V7h2V5h2V3h2z" fill="#3fd47a" />
      <path d="M8 3h2v2h2v2h-2v2H8v2H6V9H4V7h2V5h2z" fill="#9af5b8" />
      <path d="M8 3h2v2H8z" fill="#ffffff" />
    </svg>
  )
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { user, signOut } = useAuth()
  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="#/lobby" aria-label="MineBet — на главную">
          <Mark />
          <span className="wordmark">MineBet</span>
        </a>
        <nav aria-label="Разделы">
          {[...NAV, ...(user?.is_admin ? [ADMIN_NAV] : [])].map((item) => (
            <a key={item.route} href={`#/${item.route}`} className="nav-item" aria-current={route === item.route ? 'page' : undefined}>
              <img src={dataUrl(item.icon, 2)} alt="" width={20} height={20} />
              {item.label}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="who-nick">{user?.mc_nick}</span>
            <span className="who-balance">{coins(user?.balance ?? 0)} монет</span>
          </div>
          <button
            type="button"
            className="link"
            onClick={() => {
              signOut()
              go('login')
            }}
          >
            Выйти
          </button>
          <p className="legal">18+ · Монеты виртуальные, вывод — заглушка. Играйте ответственно.</p>
        </div>
      </aside>
      <main className="canvas" id="main">
        {user?.excluded_until ? (
          <p className="notice" role="status">
            Игра и пополнение заблокированы до {when(user.excluded_until)}. <a href="#/limits">Подробнее</a>
          </p>
        ) : null}
        {children}
      </main>
      <SessionReminder />
    </div>
  )
}

export function PageHead({ title, sub }: { title: string; sub?: ReactNode }) {
  const { user } = useAuth()
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="balance" aria-live="polite">
        <span className="balance-label">Баланс</span>
        <span className="balance-value">{coins(user?.balance ?? 0)}</span>
      </div>
    </header>
  )
}
