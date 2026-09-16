import { type Env } from '#src/app/env'
import { createServices, type Services } from '#src/app/services'
import { type MqttState } from '#src/health/schema'
import { createAuth, type Auth } from '#src/shared/auth/auth'
import { type Db, openDatabase } from '#src/shared/db/connection'
import { type Logger } from '#src/shared/logger'
import { type Clock } from '#src/shared/time'

export type Runtime = {
    readonly db: Db
    readonly auth: Auth
    readonly services: Services
}

/** Opens the database and builds auth and services from validated config. */
export function createRuntime(deps: {
    readonly env: Env
    readonly clock: Clock
    readonly logger: Logger
    readonly mqttState: () => MqttState
}): Runtime {
    const { env, clock, logger } = deps
    const db = openDatabase(env.DATABASE_PATH)
    const auth = createAuth(db, {
        secret: env.AUTH_SECRET,
        baseUrl: env.AUTH_URL,
        trustedOrigin: env.CORS_ORIGIN,
        rateLimit: true,
    })
    const services = createServices({
        db,
        auth,
        clock,
        logger,
        config: {
            statusDegradedMin: env.STATUS_DEGRADED_MIN,
            statusOfflineMin: env.STATUS_OFFLINE_MIN,
            lowBatteryPct: env.LOW_BATTERY_PCT,
            linkWindowMin: env.LINK_WINDOW_MIN,
        },
        mqttState: deps.mqttState,
    })
    return { db, auth, services }
}
