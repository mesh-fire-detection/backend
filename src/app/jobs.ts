import { type Services } from '#src/app/services'
import { type Logger } from '#src/shared/logger'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

const SWEEP_INTERVAL_MS = 5 * MS_PER_MINUTE

/** In-process scheduled work. Runs once at startup, then on an interval. */
export function startJobs(deps: {
    readonly services: Services
    readonly clock: Clock
    readonly logger: Logger
}): () => void {
    const { services, clock } = deps
    const logger = deps.logger.child({ component: 'jobs' })

    const sweep = (): void => {
        try {
            services.evaluation.sweepSystemAlerts(clock())
        } catch (error) {
            logger.error({ err: error }, 'system alert sweep failed')
        }
    }

    sweep()
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
    return () => {
        clearInterval(timer)
    }
}
