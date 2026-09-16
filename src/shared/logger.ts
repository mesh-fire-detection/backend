import { pino, type LevelWithSilent, type Logger } from 'pino'

export type { Logger } from 'pino'

/** JSON lines to stdout; systemd's journal collects them in production. */
export function createLogger(level: LevelWithSilent): Logger {
    return pino({ level })
}
