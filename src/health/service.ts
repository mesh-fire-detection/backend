import { type Health, type MqttState } from '#src/health/schema'
import { type EmailState } from '#src/shared/email/message'

export type HealthProbes = {
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
            const mqtt = probes.mqttState()
            const email = probes.emailState()
            const failing = database === 'failing' || mqtt === 'disconnected' || email === 'failing'
            return { status: failing ? 'failing' : 'ok', database, mqtt, email }
        },
    }
}

export type HealthService = ReturnType<typeof createHealthService>
