import { useEffect, useState } from 'react'

export type Route = 'lobby' | 'mines' | 'creeper' | 'elytra' | 'wallet' | 'history' | 'limits' | 'login' | 'register'
const ROUTES: Route[] = ['lobby', 'mines', 'creeper', 'elytra', 'wallet', 'history', 'limits', 'login', 'register']

function read(): Route {
  const name = location.hash.replace(/^#\/?/, '') as Route
  return ROUTES.includes(name) ? name : 'lobby'
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const go = (route: Route) => {
  location.hash = `#/${route}`
}
