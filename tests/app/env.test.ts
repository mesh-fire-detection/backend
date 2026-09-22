import { describe, expect, it } from 'vitest'

import { parseEnv } from '#src/app/env'

const REQUIRED = {
    AUTH_SECRET: 'a'.repeat(32),
    AUTH_URL: 'https://api.meshfiredetection.org',
    CORS_ORIGIN: 'https://meshfiredetection.org',
}
const KEY_16 = Buffer.alloc(16, 1).toString('base64')

describe('parseEnv', () => {
    it('applies defaults when optional variables are unset', () => {
        expect(parseEnv(REQUIRED)).toEqual({
            ...REQUIRED,
            PORT: 3000,
            HOST: '127.0.0.1',
            LOG_LEVEL: 'info',
            DATABASE_PATH: 'data/mesh.db',
            DEV_CONSOLE: false,
            MQTT_URL: undefined,
            MQTT_USERNAME: undefined,
            MQTT_PASSWORD: undefined,
            MQTT_TOPIC: 'msh/US/2/e/#',
            MESH_CHANNEL_KEY: undefined,
            STATUS_DEGRADED_MIN: 30,
            STATUS_OFFLINE_MIN: 120,
            LOW_BATTERY_PCT: 20,
            LINK_WINDOW_MIN: 1440,
        })
    })

    it('coerces numbers from strings', () => {
        const env = parseEnv({ ...REQUIRED, PORT: '8080', STATUS_OFFLINE_MIN: '240' })

        expect(env.PORT).toBe(8080)
        expect(env.STATUS_OFFLINE_MIN).toBe(240)
    })

    it('rejects an invalid value without echoing it', () => {
        expect(() => parseEnv({ ...REQUIRED, PORT: 'not-a-port' })).toThrow(
            /Invalid environment[\S\s]*PORT/
        )
        expect(() => parseEnv({ ...REQUIRED, PORT: 'not-a-port' })).not.toThrow(/not-a-port/)
    })

    it('requires the auth settings', () => {
        expect(() => parseEnv({})).toThrow(/AUTH_SECRET[\S\s]*AUTH_URL[\S\s]*CORS_ORIGIN/)
    })

    it('requires a private 16 or 32 byte channel key when MQTT is enabled', () => {
        const mqtt = { ...REQUIRED, MQTT_URL: 'mqtt://localhost:1883' }

        expect(() => parseEnv(mqtt)).toThrow(/MESH_CHANNEL_KEY/)
        // "AQ==" is Meshtastic's public default key shorthand.
        expect(() => parseEnv({ ...mqtt, MESH_CHANNEL_KEY: 'AQ==' })).toThrow(/MESH_CHANNEL_KEY/)
        expect(parseEnv({ ...mqtt, MESH_CHANNEL_KEY: KEY_16 }).MESH_CHANNEL_KEY).toBe(KEY_16)
    })

    it('catches a topic whose wildcard was cut off as a .env comment', () => {
        expect(() => parseEnv({ ...REQUIRED, MQTT_TOPIC: 'msh/US/2/e/' })).toThrow(
            /MQTT_TOPIC[\S\s]*quote/
        )
    })

    it('requires the offline threshold to exceed the degraded one', () => {
        expect(() =>
            parseEnv({ ...REQUIRED, STATUS_DEGRADED_MIN: '60', STATUS_OFFLINE_MIN: '60' })
        ).toThrow(/STATUS_OFFLINE_MIN/)
    })

    it('never includes secret values in errors', () => {
        const secret = 'short-secret-value'

        expect(() => parseEnv({ ...REQUIRED, AUTH_SECRET: secret })).not.toThrow(new RegExp(secret))
    })
})
