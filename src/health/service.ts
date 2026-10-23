import { APP_VERSION } from '#src/app/version'
import { type Health, type MqttState } from '#src/health/schema'
import { type NotehubHealth } from '#src/mesh/notehub/schema'
import { type EmailState } from '#src/shared/email/message'

export type HealthProbes = {
    readonly notehubHealth: () => NotehubHealth
    readonly databaseOk: () => boolean
    readonly mqttState: () => MqttState
    readonly emailState: () => EmailState
}

/**
 * `failing` when the database is down, ingest has lost its broker connection,
 * or sending has failed repeatedly. A configured service that stopped working
 * is a failure; one that was never configured is not.
 */
export function createHealthService(probes: HealthProbes) {
    return {
        check(): Health {
            const database = probes.databaseOk() ? 'ok' : 'failing'
            const notehub = probes.notehubHealth()
            const mqtt = probes.mqttState()
            const email = probes.emailState()
            const failing =
                database === 'failing' ||
                mqtt === 'disconnected' ||
                email === 'failing' ||
                notehub.status === 'failing'
            return {
                status: failing ? 'failing' : 'ok',
                version: APP_VERSION,
                database,
                mqtt,
                notehub,
                email,
            }
        },
    }
}

export type HealthService = ReturnType<typeof createHealthService>
