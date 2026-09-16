import mqtt from 'mqtt'

import { type MqttState } from '#src/health/schema'
import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { type IngestService } from '#src/mesh/ingest/service'
import { type Logger } from '#src/shared/logger'
import { type Clock } from '#src/shared/time'

export type SubscriberConfig = {
    readonly url: string
    readonly username: string | undefined
    readonly password: string | undefined
    readonly topic: string
    readonly channelKey: Buffer
}

export type Subscriber = {
    readonly state: () => MqttState
    readonly close: () => Promise<void>
}

/** Largest envelope worth decoding; LoRa payloads are a few hundred bytes. */
const MAX_MESSAGE_BYTES = 4096

/**
 * The second entry point beside HTTP. Each message is decoded, validated, and
 * handed to the ingest service. One bad message never stops the stream.
 */
export function startSubscriber(deps: {
    readonly config: SubscriberConfig
    readonly ingest: IngestService
    readonly clock: Clock
    readonly logger: Logger
}): Subscriber {
    const { config, ingest, clock } = deps
    const logger = deps.logger.child({ component: 'mqtt' })
    let connected = false

    const client = mqtt.connect(config.url, {
        ...(config.username !== undefined && { username: config.username }),
        ...(config.password !== undefined && { password: config.password }),
        clientId: `mesh-backend-${process.pid}`,
        // Persistent session: the broker queues QoS 1 messages while we restart.
        clean: false,
        reconnectPeriod: 5000,
    })

    client.on('connect', () => {
        connected = true
        logger.info({ topic: config.topic }, 'connected to broker')
        client.subscribe(config.topic, { qos: 1 }, (error) => {
            if (error) logger.error({ err: error }, 'subscribe failed')
        })
    })
    client.on('close', () => {
        if (connected) logger.warn('broker connection closed')
        connected = false
    })
    client.on('error', (error) => {
        logger.error({ err: error }, 'broker error')
    })

    client.on('message', (topic, payload) => {
        try {
            if (payload.length > MAX_MESSAGE_BYTES) {
                logger.warn({ topic, bytes: payload.length }, 'dropped: message too large')
                return
            }
            const decoded = decodeEnvelope(payload, config.channelKey)
            if (!decoded.ok) {
                logger.debug({ topic, reason: decoded.reason }, 'dropped packet')
                return
            }
            const outcome = ingest.handle(decoded.packet, clock())
            if (outcome.accepted) return
            const log = outcome.reason === 'duplicate' ? logger.debug : logger.warn
            log.call(
                logger,
                {
                    topic,
                    reason: outcome.reason,
                    from: decoded.packet.fromNodeNum,
                    gateway: decoded.packet.gatewayNodeNum,
                },
                'dropped packet'
            )
        } catch (error) {
            logger.error({ err: error, topic }, 'ingest failed')
        }
    })

    return {
        state: () => (connected ? 'connected' : 'disconnected'),
        close: async () => {
            await client.endAsync()
        },
    }
}
