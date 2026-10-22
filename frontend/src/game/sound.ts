import { useSyncExternalStore } from 'react'

// Every sound is synthesised here with Web Audio: no files, nothing borrowed from the original game.

const KEY = 'minebet.sound'
const listeners = new Set<() => void>()
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
})()

let ctx: AudioContext | null = null
const context = () => {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export const soundOn = () => on

export function setSound(next: boolean) {
  on = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    /* not remembered */
  }
  listeners.forEach((l) => l())
}

export function useSound(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    soundOn,
  )
}

/** One enveloped tone starting `at` seconds from now, gliding from `freq` to `to` if given. */
function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, at = 0, to?: number) {
  if (!on) return
  const c = context()
  if (!c) return
  const t = c.currentTime + at
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function noise(dur: number, vol = 0.08, at = 0, cutoff = 900) {
  if (!on) return
  const c = context()
  if (!c) return
  const t = c.currentTime + at
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  const gain = c.createGain()
  gain.gain.value = vol
  src.connect(filter).connect(gain).connect(c.destination)
  src.start(t)
}

const NOTES = [262, 330, 392, 523, 659, 784, 1047, 1319]

export const sfx = {
  click: () => tone(520, 0.05, 'square', 0.035),
  spin: () => {
    tone(180, 0.12, 'square', 0.04, 0, 90)
    noise(0.1, 0.03, 0, 600)
  },
  stop: (i = 0) => tone(140 + i * 12, 0.07, 'triangle', 0.07),
  win: (n = 0) => {
    for (let i = 0; i < 3; i++) tone(NOTES[Math.min(i + n, NOTES.length - 1)], 0.14, 'square', 0.05, i * 0.08)
  },
  lose: () => tone(220, 0.25, 'triangle', 0.05, 0, 110),
  explode: (wave = 0) => {
    noise(0.3, 0.12, 0, 700 + wave * 150)
    tone(120 + wave * 25, 0.25, 'sawtooth', 0.05, 0, 50)
  },
  creeper: () => {
    noise(0.7, 0.14, 0.1, 500)
    tone(90, 0.7, 'sawtooth', 0.07, 0, 35)
  },
  dynamite: () => {
    for (let i = 0; i < 3; i++) tone(880, 0.1, 'square', 0.05, i * 0.14)
    tone(440, 0.5, 'triangle', 0.06, 0.45, 880)
  },
  cash: () => {
    tone(988, 0.08, 'square', 0.05)
    tone(1319, 0.2, 'square', 0.05, 0.08)
  },
  crash: () => {
    noise(0.5, 0.14, 0, 1200)
    tone(300, 0.5, 'sawtooth', 0.06, 0, 40)
  },
  /** Rising arpeggio, longer and brighter with the tier (1..5). */
  fanfare: (tier: number) => {
    const steps = 3 + tier * 2
    for (let i = 0; i < steps; i++) {
      const f = NOTES[i % NOTES.length] * (i >= NOTES.length ? 2 : 1)
      tone(f, 0.18, 'square', 0.05, i * 0.09)
      if (tier >= 3) tone(f / 2, 0.18, 'triangle', 0.05, i * 0.09)
    }
    if (tier >= 4) noise(0.8, 0.06, steps * 0.09, 4000)
  },
}
