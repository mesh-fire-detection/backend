import { type Health, type MqttState } from '#src/health/schema'

export type HealthProbes = {
    readonly databaseOk: () => boolean
    readonly mqttState: () => MqttState
}

/** `failing` when the database is down or ingest has lost its broker connection. */
export function createHealthService(probes: HealthProbes) {
    return {
        check(): Health {
            const database = probes.databaseOk() ? 'ok' : 'failing'
            const mqtt = probes.mqttState()
            const status = database === 'ok' && mqtt !== 'disconnected' ? 'ok' : 'failing'
            return { status, database, mqtt }
        },
    }
}

export type HealthService = ReturnType<typeof createHealthService>
