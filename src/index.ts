import process from 'node:process'

import { serve } from '@hono/node-server'

import { parseEnv } from '#src/app/env'
import { startJobs } from '#src/app/jobs'
import { createRuntime } from '#src/app/runtime'
import { createApp } from '#src/app/server'
import { APP_VERSION } from '#src/app/version'
import { startSubscriber, type Subscriber } from '#src/mesh/ingest/subscriber'
import { closeDatabase } from '#src/shared/db/connection'
import { createLogger } from '#src/shared/logger'
import { systemClock } from '#src/shared/time'

const bootLogger = createLogger('info')

try {
    const env = parseEnv(process.env)
    const logger = createLogger(env.LOG_LEVEL)
    const clock = systemClock

    let subscriber: Subscriber | undefined
    const { db, auth, services, email } = createRuntime({
        env,
        clock,
        logger,
        mqttState: () => subscriber?.state() ?? 'disabled',
    })

    if (env.MQTT_URL === undefined) {
        logger.warn('MQTT_URL is not set; ingest is disabled')
    } else {
        subscriber = startSubscriber({
            config: {
                url: env.MQTT_URL,
                username: env.MQTT_USERNAME,
                password: env.MQTT_PASSWORD,
                topic: env.MQTT_TOPIC,
                // env.ts guarantees a 16 or 32 byte key whenever MQTT_URL is set.
                channelKey: Buffer.from(env.MESH_CHANNEL_KEY ?? '', 'base64'),
            },
            ingest: services.ingest,
            clock,
            logger,
            events: services.events,
        })
    }

    const stopJobs = startJobs({ services, clock, logger })
    const app = createApp({
        logger,
        auth,
        services,
        corsOrigin: env.CORS_ORIGIN,
        devConsole: env.DEV_CONSOLE,
        emailPreview: email.preview,
    })
    const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
        logger.info({ host: info.address, port: info.port }, 'listening')
        // The version, so every deploy shows in the event log.
        services.events.record('server.started', { details: { version: APP_VERSION } })
    })

    const shutdown = (signal: NodeJS.Signals): void => {
        logger.info({ signal }, 'shutting down')
        stopJobs()
        services.events.record('server.stopping', { details: { signal } })
        // Counts not yet written would otherwise be lost with the process.
        services.events.flush()
        void (subscriber?.close() ?? Promise.resolve()).finally(() => {
            server.close((error) => {
                closeDatabase(db)
                if (!error) return
                logger.error({ err: error }, 'shutdown failed')
                process.exitCode = 1
            })
        })
    }

    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
} catch (error) {
    bootLogger.fatal({ err: error }, 'startup failed')
    process.exitCode = 1
}
