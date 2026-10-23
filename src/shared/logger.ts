import { pino, type LevelWithSilent, type Logger } from 'pino'

export type { Logger } from 'pino'

/** Anywhere log lines can go. Stdout in production; a test collects them instead. */
export type LogDestination = { readonly write: (line: string) => void }

/**
 * JSON lines to stdout; systemd's journal collects them in production.
 *
 * A destination can be supplied so a test can read what was written, which is
 * how the rule that codes and addresses never reach the logs is enforced
 * rather than merely intended.
 */
export function createLogger(level: LevelWithSilent, destination?: LogDestination): Logger {
    return destination === undefined ? pino({ level }) : pino({ level }, destination)
}
