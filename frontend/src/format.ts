const nf = new Intl.NumberFormat('ru-RU')

/** 12 345 — thin non-breaking separators, no decimals: coins are whole numbers. */
export const coins = (n: number) => nf.format(n).replace(/\u00a0/g, '\u202f')

/** Multiplier given in hundredths (Elytra): 137 -> "1.37×". */
export const hundredths = (m: number) => `${(m / 100).toFixed(2)}×`

export const signed = (n: number) => (n > 0 ? `+${coins(n)}` : n < 0 ? `−${coins(-n)}` : '0')

const df = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
export const when = (iso: string) => df.format(new Date(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`))

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
