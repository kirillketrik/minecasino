import { useSyncExternalStore } from 'react'

// Every sound and every piece of music is synthesised here with Web Audio: no files, nothing
// borrowed from the original game. Sound effects and music are two switches; each slot has its own
// theme (`enterTheme`) that picks both its background music and the voice of its sound effects.

export type Theme = 'mines' | 'creeper' | 'ender' | 'drill' | 'elytra'

const SOUND_KEY = 'minebet.sound'
const MUSIC_KEY = 'minebet.music'

function flag(key: string) {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true
  }
}

function remember(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* not remembered */
  }
}

const listeners = new Set<() => void>()
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const notify = () => listeners.forEach((l) => l())

let on = flag(SOUND_KEY)
let musicEnabled = flag(MUSIC_KEY)

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
export const musicOn = () => musicEnabled

export function setSound(next: boolean) {
  on = next
  remember(SOUND_KEY, next)
  notify()
}

export function setMusic(next: boolean) {
  musicEnabled = next
  remember(MUSIC_KEY, next)
  syncMusic()
  notify()
}

export const useSound = (): boolean => useSyncExternalStore(subscribe, soundOn)
export const useMusic = (): boolean => useSyncExternalStore(subscribe, musicOn)

// --- sound effects --------------------------------------------------------------------------------

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

function noise(dur: number, vol = 0.08, at = 0, cutoff = 900, type: BiquadFilterType = 'lowpass') {
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
  filter.type = type
  filter.frequency.value = cutoff
  const gain = c.createGain()
  gain.gain.value = vol
  src.connect(filter).connect(gain).connect(c.destination)
  src.start(t)
}

/** A struck bell: a sine with a quiet octave-and-a-bit partial. */
function bell(freq: number, at = 0, vol = 0.05, dur = 0.5) {
  tone(freq, dur, 'sine', vol, at)
  tone(freq * 2.76, dur * 0.5, 'sine', vol * 0.35, at)
}

let theme: Theme | null = null
const NOTES = [262, 330, 392, 523, 659, 784, 1047, 1319]
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17]

export const sfx = {
  click: () => tone(520, 0.05, 'square', 0.035),
  spin: () => {
    if (theme === 'mines') {
      // Pick strikes on rock.
      for (let i = 0; i < 3; i++) {
        tone(1900 - i * 260, 0.04, 'triangle', 0.035, i * 0.055)
        noise(0.04, 0.035, i * 0.055, 3500, 'highpass')
      }
    } else if (theme === 'creeper') {
      // A long hiss.
      noise(0.5, 0.05, 0, 3500, 'highpass')
      tone(70, 0.4, 'sawtooth', 0.025, 0, 55)
    } else if (theme === 'ender') {
      // A portal warble.
      tone(280, 0.4, 'sine', 0.04, 0, 900)
      tone(284, 0.4, 'sine', 0.03, 0, 620)
    } else if (theme === 'drill') {
      // The motor spins up.
      tone(80, 0.3, 'sawtooth', 0.04, 0, 300)
      noise(0.25, 0.03, 0, 1800, 'bandpass')
    } else {
      tone(180, 0.12, 'square', 0.04, 0, 90)
      noise(0.1, 0.03, 0, 600)
    }
  },
  stop: (i = 0) => {
    if (theme === 'mines') {
      tone(120, 0.12, 'sine', 0.09, 0, 55)
      noise(0.07, 0.05, 0, 500)
    } else if (theme === 'ender') {
      bell(900 + i * 90, 0, 0.035, 0.35)
    } else if (theme === 'drill') {
      noise(0.05, 0.06, 0, 3500, 'highpass')
      tone(240 + i * 12, 0.07, 'square', 0.04)
    } else {
      tone(140 + i * 12, 0.07, 'triangle', 0.07)
    }
  },
  win: (n = 0) => {
    const k = Math.min(n, 4)
    if (theme === 'mines') {
      for (let i = 0; i < 3; i++) bell(523 * 2 ** (PENTA[(i * 2 + k) % PENTA.length] / 12), i * 0.08, 0.045, 0.4)
    } else if (theme === 'ender') {
      for (let i = 0; i < 4; i++) bell(660 * 2 ** (PENTA[(i + k) % PENTA.length] / 12), i * 0.07, 0.035, 0.7)
    } else if (theme === 'drill') {
      for (let i = 0; i < 4; i++) tone(1568 + (i % 2) * 330, 0.07, 'square', 0.035, i * 0.06)
    } else {
      for (let i = 0; i < 3; i++) tone(NOTES[Math.min(i + n, NOTES.length - 1)], 0.14, 'square', 0.05, i * 0.08)
    }
  },
  lose: () => {
    if (theme === 'creeper') tone(260, 0.4, 'sawtooth', 0.04, 0, 90)
    else if (theme === 'ender') {
      tone(330, 0.5, 'sine', 0.04, 0, 160)
      tone(335, 0.5, 'sine', 0.03, 0, 120)
    } else if (theme === 'drill') {
      tone(200, 0.12, 'square', 0.04)
      tone(140, 0.2, 'square', 0.04, 0.1)
    } else tone(220, 0.25, 'triangle', 0.05, 0, 110)
  },
  explode: (wave = 0) => {
    if (theme === 'ender') {
      noise(0.4, 0.1, 0, 400 + wave * 120)
      tone(70 + wave * 10, 0.5, 'sine', 0.08, 0, 38)
    } else if (theme === 'drill' || theme === 'mines') {
      // Rock giving way: a crack and a rumble.
      noise(0.08, 0.1, 0, 4000, 'highpass')
      noise(0.35, 0.12, 0.03, 450 + wave * 120)
      tone(95 + wave * 15, 0.3, 'sawtooth', 0.05, 0, 40)
    } else {
      noise(0.3, 0.12, 0, 700 + wave * 150)
      tone(120 + wave * 25, 0.25, 'sawtooth', 0.05, 0, 50)
    }
  },
  creeper: () => {
    noise(0.7, 0.14, 0.1, 500)
    tone(90, 0.7, 'sawtooth', 0.07, 0, 35)
    if (theme === 'ender') noise(0.5, 0.05, 0, 3000, 'highpass')
  },
  dynamite: () => {
    if (theme === 'ender') {
      for (let i = 0; i < 3; i++) bell(990 + i * 220, i * 0.1, 0.04, 0.5)
      tone(300, 0.5, 'sine', 0.05, 0.3, 1200)
    } else if (theme === 'mines' || theme === 'drill') {
      // A fuse hissing, then the shout of the blast.
      noise(0.45, 0.04, 0, 5000, 'highpass')
      tone(520, 0.4, 'triangle', 0.04, 0.05, 900)
      tone(70, 0.25, 'sawtooth', 0.05, 0.45, 40)
    } else {
      for (let i = 0; i < 3; i++) tone(880, 0.1, 'square', 0.05, i * 0.14)
      tone(440, 0.5, 'triangle', 0.06, 0.45, 880)
    }
  },
  /** A chest swinging open: a creak and a handful of coins. */
  chest: () => {
    tone(150, 0.3, 'sawtooth', 0.025, 0, 260)
    for (let i = 0; i < 5; i++) tone(1760 + (i % 3) * 260, 0.06, 'square', 0.03, 0.2 + i * 0.05)
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

// --- music ----------------------------------------------------------------------------------------

const MUSIC_LEVEL = 0.55

let bus: GainNode | null = null
function musicBus(c: AudioContext) {
  if (bus) return bus
  bus = c.createGain()
  bus.gain.value = 0
  bus.connect(c.destination)
  // A soft echo that gives every voice some room.
  const delay = c.createDelay(1)
  delay.delayTime.value = 0.34
  const feedback = c.createGain()
  feedback.gain.value = 0.34
  const damp = c.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 2400
  const wet = c.createGain()
  wet.gain.value = 0.32
  bus.connect(delay)
  delay.connect(damp).connect(feedback).connect(delay)
  damp.connect(wet).connect(c.destination)
  return bus
}

const rate = (root: number, semi: number) => root * 2 ** (semi / 12)

/** One music voice at absolute time `t`. */
function note(c: AudioContext, t: number, freq: number, dur: number, type: OscillatorType, vol: number, attack = 0.01, to?: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(musicBus(c))
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

function hush(c: AudioContext, t: number, dur: number, vol: number, cutoff: number, type: BiquadFilterType = 'lowpass', swell = false) {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const k = i / data.length
    data[i] = (Math.random() * 2 - 1) * (swell ? Math.sin(Math.PI * k) : 1 - k)
  }
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = type
  filter.frequency.value = cutoff
  const gain = c.createGain()
  gain.gain.value = vol
  src.connect(filter).connect(gain).connect(musicBus(c))
  src.start(t)
}

const kick = (c: AudioContext, t: number, vol = 0.12) => note(c, t, 150, 0.2, 'sine', vol, 0.003, 42)
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

type Song = { bpm: number; step: (c: AudioContext, s: number, t: number) => void }

/** Mines: a slow cave. A pad that breathes, drips of pentatonic bell notes in the echo. */
const mines: Song = {
  bpm: 70,
  step(c, s, t) {
    const bar = (s >> 4) % 4
    const p = s & 15
    const chord = [0, -4, 3, -2][bar]
    const root = 110
    if (p === 0) {
      note(c, t, rate(root, chord), 4.2, 'triangle', 0.045, 0.7)
      note(c, t, rate(root * 2, chord + 7), 4.2, 'sine', 0.03, 0.9)
      note(c, t, rate(root * 2, chord + 12 + (bar % 2 ? 3 : 4)), 4.2, 'sine', 0.022, 1.1)
    }
    if (p % 2 === 0 && Math.random() < 0.34) {
      const f = rate(root * 4, pick(PENTA) + chord)
      note(c, t, f, 1.1, 'sine', 0.035, 0.01)
      note(c, t, f * 2.01, 0.5, 'sine', 0.012, 0.01)
    }
    if (p === 10 && bar % 2 === 1) note(c, t, 1850, 0.12, 'sine', 0.02, 0.005, 1400) // a drip
    if (p === 8 && bar === 3) hush(c, t, 2.4, 0.012, 600, 'lowpass', true) // cave wind
  },
}

/** Creeper: tense and creeping. A restless bass, ticking hats, stabs that never resolve. */
const creeper: Song = {
  bpm: 104,
  step(c, s, t) {
    const bar = (s >> 4) % 8
    const p = s & 15
    const root = 82.4
    const bass = [0, 0, 12, 0, 0, 0, 10, 0][(p >> 1) & 7]
    if (p % 2 === 0) note(c, t, rate(root, bass + (bar >= 4 ? 1 : 0)), 0.18, 'sawtooth', 0.045, 0.004)
    if (p % 4 === 2) hush(c, t, 0.05, 0.03, 6000, 'highpass')
    if (p === 0 && bar % 2 === 1) for (const semi of [0, 3, 6]) note(c, t, rate(root * 4, semi), 0.22, 'square', 0.02, 0.005)
    if (p % 2 === 1) note(c, t, rate(root * 4, [0, 1, 3, 1][(p >> 1) & 3]), 0.09, 'square', 0.012, 0.004)
    if (bar === 7 && p === 0) hush(c, t, 3.3, 0.035, 5000, 'highpass', true) // a fuse about to burn
    if (bar === 7 && p % 4 === 0) kick(c, t, 0.07)
  },
}

/** Ender: weightless. Slow pads that drift between two chords, bells in the dark, a deep hum. */
const ender: Song = {
  bpm: 60,
  step(c, s, t) {
    const bar = (s >> 4) % 4
    const p = s & 15
    const root = 73.4
    const chord = [[0, 7, 14, 17], [-4, 3, 7, 14], [-2, 5, 9, 14], [-5, 2, 7, 12]][bar]
    if (p === 0) {
      chord.forEach((semi, i) => {
        note(c, t, rate(root * 2, semi), 4.6, i % 2 ? 'sine' : 'triangle', 0.028, 1.4)
        note(c, t, rate(root * 2, semi) * 1.004, 4.6, 'sine', 0.018, 1.6)
      })
      if (bar % 2 === 0) note(c, t, 36.7, 5, 'sine', 0.07, 1.2)
    }
    if (p % 4 === 0 && Math.random() < 0.38) {
      const f = rate(root * 8, pick([0, 2, 3, 7, 10, 12, 14]))
      note(c, t, f, 2.4, 'sine', 0.02, 0.01)
      note(c, t, f * 2.76, 0.8, 'sine', 0.006, 0.01)
    }
    if (p === 8 && bar === 1) hush(c, t, 3, 0.02, 2200, 'bandpass', true)
  },
}

/** Drill: a working machine. Kick, clap and hats, a chugging bass and chiptune hooks. */
const drill: Song = {
  bpm: 118,
  step(c, s, t) {
    const bar = (s >> 4) % 4
    const p = s & 15
    const root = 73.4
    if (p % 4 === 0) kick(c, t)
    if (p % 8 === 4) hush(c, t, 0.12, 0.05, 2200, 'bandpass')
    if (p % 2 === 0) hush(c, t, 0.03, p % 4 === 2 ? 0.035 : 0.018, 7000, 'highpass')
    const bass = [0, 0, 0, 12, 0, 0, 10, 0][(p >> 1) & 7] + (bar === 3 ? -2 : 0)
    if (p % 2 === 0) note(c, t, rate(root, bass), 0.16, 'square', 0.035, 0.004)
    if (p === 6 && Math.random() < 0.55) note(c, t, 1320 + Math.random() * 400, 0.05, 'square', 0.014, 0.002, 900) // metal ring
    if (bar >= 2 && p % 2 === 1) {
      const idx = (s >> 1) % 8
      note(c, t, rate(root * 4, [0, 3, 7, 10, 12, 10, 7, 3][idx]), 0.1, 'square', 0.014, 0.004)
    }
  },
}

/** Elytra: open air. A bright rising arpeggio over a light pulse and a breath of wind. */
const elytra: Song = {
  bpm: 126,
  step(c, s, t) {
    const bar = (s >> 4) % 4
    const p = s & 15
    const chord = [0, 5, 7, 4][bar]
    const root = 130.8
    if (p % 2 === 0) note(c, t, rate(root * 2, chord + [0, 4, 7, 11, 12, 11, 7, 4][(p >> 1) & 7]), 0.2, 'triangle', 0.03, 0.006)
    if (p % 4 === 0) kick(c, t, 0.06)
    if (p === 0) {
      note(c, t, rate(root, chord), 2.2, 'sine', 0.04, 0.5)
      note(c, t, rate(root * 4, chord + 11), 1.2, 'sine', 0.012, 0.05)
    }
    if (p === 0 && bar % 2 === 0) hush(c, t, 2, 0.018, 1800, 'bandpass', true)
    if (p % 4 === 2) hush(c, t, 0.03, 0.012, 8000, 'highpass')
  },
}

const SONGS: Record<Theme, Song> = { mines, creeper, ender, drill, elytra }

let current: Theme | null = null
let timer: number | undefined
let step = 0
let nextTime = 0
let armed = false

function tick() {
  const c = ctx
  if (!c || !current || !musicEnabled || c.state !== 'running') return
  const song = SONGS[current]
  if (nextTime < c.currentTime) nextTime = c.currentTime + 0.05
  while (nextTime < c.currentTime + 0.35) {
    song.step(c, step, nextTime)
    nextTime += 60 / song.bpm / 4
    step++
  }
}

function fade(to: number, seconds: number) {
  const c = ctx
  if (!c) return
  const gain = musicBus(c).gain
  gain.cancelScheduledValues(c.currentTime)
  gain.setValueAtTime(gain.value, c.currentTime)
  gain.linearRampToValueAtTime(to, c.currentTime + seconds)
}

/** Browsers only let audio start after a gesture; wait for the first one. */
function arm() {
  if (armed) return
  armed = true
  const go = () => {
    armed = false
    window.removeEventListener('pointerdown', go)
    window.removeEventListener('keydown', go)
    syncMusic()
  }
  window.addEventListener('pointerdown', go)
  window.addEventListener('keydown', go)
}

function syncMusic() {
  const want = current !== null && musicEnabled
  if (!want) {
    if (ctx) fade(0, 0.5)
    return
  }
  if (!ctx) {
    if (!navigator.userActivation?.hasBeenActive) return arm()
    context()
  }
  const c = ctx!
  if (c.state !== 'running') {
    void c.resume().then(syncMusic)
    return arm()
  }
  fade(MUSIC_LEVEL, 1.6)
  if (timer === undefined) timer = window.setInterval(tick, 90)
}

/** Called by a game page: its music starts and its effects take the slot's voice. */
export function enterTheme(next: Theme) {
  theme = next
  current = next
  step = 0
  nextTime = 0
  syncMusic()
}

export function leaveTheme(from: Theme) {
  if (theme !== from) return
  theme = null
  current = null
  syncMusic()
}
