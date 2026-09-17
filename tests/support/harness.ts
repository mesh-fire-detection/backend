import { randomUUID } from 'node:crypto'

import { createApp } from '#src/app/server'
import { createServices, type AppConfig } from '#src/app/services'
import { type MqttState } from '#src/health/schema'
import { type Role } from '#src/shared/auth/access'
import { createAuth } from '#src/shared/auth/auth'
import { openDatabase } from '#src/shared/db/connection'
import { createLogger } from '#src/shared/logger'

export const SITE_ORIGIN = 'https://meshfiredetection.org'
export const START = new Date('2026-06-01T12:00:00.000Z')

export const TEST_CONFIG: AppConfig = {
    statusDegradedMin: 30,
    statusOfflineMin: 120,
    lowBatteryPct: 20,
    linkWindowMin: 1440,
}

type RequestOptions = {
    readonly method?: string
    readonly body?: unknown
    readonly cookie?: string
    readonly headers?: Readonly<Record<string, string>>
}

/** A fresh in-memory database, services, and HTTP app per call, with a controllable clock. */
export function createHarness() {
    let now = START.getTime()
    let mqttState: MqttState = 'disabled'
    const clock = () => new Date(now)
    const logger = createLogger('silent')

    const db = openDatabase(':memory:')
    const auth = createAuth(db, {
        secret: 'test-secret-that-is-at-least-32-characters',
        baseUrl: 'http://localhost:3000',
        trustedOrigin: SITE_ORIGIN,
        rateLimit: false,
    })
    const services = createServices({
        db,
        auth,
        clock,
        logger,
        config: TEST_CONFIG,
        mqttState: () => mqttState,
    })
    const app = createApp({ logger, auth, services, corsOrigin: SITE_ORIGIN })

    const request = (path: string, options: RequestOptions = {}): Promise<Response> => {
        const headers: Record<string, string> = {
            origin: SITE_ORIGIN,
            ...options.headers,
            ...(options.cookie !== undefined && { cookie: options.cookie }),
            ...(options.body !== undefined && { 'content-type': 'application/json' }),
        }
        return Promise.resolve(
            app.request(path, {
                method: options.method ?? 'GET',
                headers,
                ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
            })
        )
    }

    /** Signs in through the real auth endpoint and returns the session cookie. */
    const signIn = async (email: string, password: string): Promise<string> => {
        const response = await request('/v1/auth/sign-in/email', {
            method: 'POST',
            body: { email, password },
        })
        if (response.status !== 200) {
            throw new Error(`sign-in failed with ${response.status}: ${await response.text()}`)
        }
        const cookies = response.headers.getSetCookie().map((line) => line.split(';', 1)[0])
        return cookies.join('; ')
    }

    /** Creates an account with the given role and returns its id and session cookie. */
    const signInAs = async (role: Role): Promise<{ id: string; cookie: string }> => {
        const email = `${role}-${randomUUID()}@example.org`
        const password = 'correct horse battery'
        const { user } = await auth.api.createUser({
            body: { email, name: `Test ${role}`, password, role },
        })
        return { id: user.id, cookie: await signIn(email, password) }
    }

    return {
        db,
        auth,
        app,
        services,
        clock,
        request,
        signIn,
        signInAs,
        setMqttState: (state: MqttState) => {
            mqttState = state
        },
        advance: (ms: number) => {
            now += ms
        },
    }
}

export type Harness = ReturnType<typeof createHarness>
