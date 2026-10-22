import { useSyncExternalStore } from 'react'

export type Speed = 'normal' | 'fast' | 'turbo'

export const SPEEDS: { id: Speed; label: string; factor: number }[] = [
  { id: 'normal', label: 'Обычная', factor: 1 },
  { id: 'fast', label: 'Быстрая', factor: 0.5 },
  { id: 'turbo', label: 'Турбо', factor: 0.15 },
]

const KEY = 'minebet.speed'
const listeners = new Set<() => void>()

let current: Speed = (() => {
  try {
    const stored = localStorage.getItem(KEY)
    return SPEEDS.some((s) => s.id === stored) ? (stored as Speed) : 'normal'
  } catch {
    return 'normal'
  }
})()

export const getSpeed = () => current
/** Multiplier for every animation duration and pause. */
export const speedFactor = () => SPEEDS.find((s) => s.id === current)!.factor

export function setSpeed(next: Speed) {
  current = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* the choice is simply not remembered */
  }
  listeners.forEach((l) => l())
}

export function useSpeed(): Speed {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSpeed,
  )
}
