/** Injected everywhere "now" matters, so tests control time. */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()

export const MS_PER_SECOND = 1000
export const MS_PER_MINUTE = 60 * MS_PER_SECOND
