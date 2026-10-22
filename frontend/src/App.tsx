import { useEffect } from 'react'
import { AuthProvider, useAuth } from './auth.tsx'
import { go, useRoute } from './route.ts'
import Auth from './pages/Auth.tsx'
import Creeper from './pages/Creeper.tsx'
import Elytra from './pages/Elytra.tsx'
import Admin from './pages/Admin.tsx'
import History from './pages/History.tsx'
import Limits from './pages/Limits.tsx'
import Lobby from './pages/Lobby.tsx'
import Mines from './pages/Mines.tsx'
import Wallet from './pages/Wallet.tsx'
import { Shell } from './ui/shell.tsx'

function Routes() {
  const route = useRoute()
  const { user, loading } = useAuth()
  const guest = route === 'login' || route === 'register'

  useEffect(() => {
    if (loading) return
    if (!user && !guest) go('login')
    else if (user && guest) go('lobby')
  }, [user, loading, guest])

  if (loading) return <p className="boot" role="status">Загрузка…</p>
  if (!user) return guest ? <Auth mode={route} /> : null

  const page = {
    lobby: <Lobby />,
    mines: <Mines />,
    creeper: <Creeper />,
    elytra: <Elytra />,
    wallet: <Wallet />,
    history: <History />,
    limits: <Limits />,
    admin: user.is_admin ? <Admin /> : <Lobby />,
    login: null,
    register: null,
  }[route]

  return (
    <Shell route={route}>
      <a className="skip" href="#main">К содержимому</a>
      {page}
    </Shell>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  )
}
