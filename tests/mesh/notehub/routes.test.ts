import { describe, expect, it } from 'vitest'

import { createHarness } from '#tests/support/harness'
import {
    deliver,
    notehubEvent,
    notehubHarness,
    NOTEHUB_TOKEN,
    NOTECARD_UID,
} from '#tests/support/notehub'
import { deviceInput } from '#tests/support/seed'

describe('Notehub route', () => {
    it('stores encrypted particle telemetry and exposes it through authenticated history', async () => {
        const h = notehubHarness()
        const response = await deliver(h, {
            ...notehubEvent(h),
            tower_lat: 47,
            session: 'ignored metadata',
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ inserted: 1, duplicates: 0 })
        const user = await h.signInAs('user')
        const history = await h.request('/v1/devices/sen-01/readings', { cookie: user.cookie })
        expect(await history.json()).toMatchObject({
            readings: [
                {
                    metric: 'airQualityMetrics.pm25Standard',
                    value: 25,
                    recordedAt: h.clock().toISOString(),
                },
                { metric: 'airQualityMetrics.pm25Environmental', value: 20 },
                { metric: 'airQualityMetrics.particles100um', value: 0 },
            ],
        })
        expect(h.services.devices.get('sen-01').lastHeardAt).toBe(h.clock().toISOString())
        const health = await h.request('/health')
        expect(await health.json()).toMatchObject({
            notehub: { status: 'ok', lastReceivedAt: h.clock().toISOString() },
        })
    })

    it('rejects anonymous, invalid-credential and browser-session calls before validation', async () => {
        const h = notehubHarness()
        const admin = await h.signInAs('admin')
        for (const cookie of [undefined, admin.cookie]) {
            const response = await h.request('/v1/ingest/notehub', {
                method: 'POST',
                body: {},
                ...(cookie !== undefined && { cookie }),
            })
            expect(response.status).toBe(401)
        }
        const invalid = await deliver(h, {}, 'b'.repeat(64))
        expect(invalid.status).toBe(401)
        expect(h.services.readings.readings('sen-01', {}).readings).toHaveLength(0)
    })

    it('binds both cloud and encrypted envelope gateway identities to the credential', async () => {
        const h = notehubHarness()
        const wrongUid = await deliver(h, { ...notehubEvent(h), device: 'dev:860322068099999' })
        const wrongGateway = await deliver(h, notehubEvent(h, { gateway: 0x99 }))
        expect(wrongUid.status).toBe(403)
        expect(wrongGateway.status).toBe(403)
        expect(h.services.readings.readings('sen-01', {}).readings).toHaveLength(0)
    })

    it('rejects unknown or disabled senders and gateways', async () => {
        const h = notehubHarness()
        const unknown = await deliver(h, notehubEvent(h, { from: 0x99 }))
        expect(unknown.status).toBe(403)
        h.services.devices.update('sen-01', { enabled: false })
        const disabledSender = await deliver(h, notehubEvent(h))
        expect(disabledSender.status).toBe(403)
        h.services.gateways.update('cel-01', { enabled: false })
        const disabledGateway = await deliver(h, notehubEvent(h))
        expect(disabledGateway.status).toBe(403)
        h.services.gateways.update('cel-01', { enabled: true })
        h.services.devices.update('cel-01', { enabled: false })
        const disabledDevice = await deliver(h, notehubEvent(h))
        expect(disabledDevice.status).toBe(403)
    })

    it('rotates and revokes credentials without exposing them in gateway responses', async () => {
        const h = notehubHarness()
        const admin = await h.signInAs('admin')
        const token = 'new-notehub-token-'.padEnd(64, 'b')
        const updated = await h.request('/v1/gateways/cel-01', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { notehubToken: token },
        })
        expect(updated.status).toBe(200)
        const text = await updated.text()
        expect(text).not.toContain(token)
        expect(text).not.toContain('notehubTokenHash')
        expect(text).not.toContain(NOTEHUB_TOKEN)
        const oldCredential = await deliver(h, notehubEvent(h))
        const newCredential = await deliver(h, notehubEvent(h), token)
        expect(oldCredential.status).toBe(401)
        expect(newCredential.status).toBe(200)
        h.services.gateways.update('cel-01', { notehubToken: null })
        const revoked = await deliver(h, notehubEvent(h), token)
        expect(revoked.status).toBe(401)
    })

    it('requires explicit backend enablement', async () => {
        const h = createHarness()
        const enabled = notehubHarness()
        h.services.devices.register(deviceInput({ id: 'cel-01', type: 'cellular' }))
        h.services.gateways.register({
            deviceId: 'cel-01',
            notecardUid: NOTECARD_UID,
            notehubToken: NOTEHUB_TOKEN,
        })
        const response = await deliver(h, notehubEvent(enabled))
        expect(response.status).toBe(503)
    })

    it('rejects malformed, oversized, plaintext and wrong-key deliveries', async () => {
        const h = notehubHarness()
        const event = notehubEvent(h)
        for (const body of [
            {},
            [],
            Array.from({ length: 17 }, () => event),
            { ...event, file: 'other.qo' },
            { ...event, body: { ...event.body, version: 2 } },
            { ...event, body: { ...event.body, envelope: 'not base64' } },
            notehubEvent(h, { encrypt: false }),
            notehubEvent(h, { key: Buffer.alloc(16, 99) }),
        ]) {
            const response = await deliver(h, body)
            expect(response.status).toBe(400)
        }
        const oversized = await deliver(h, { ...event, padding: 'a'.repeat(65_536) })
        expect(oversized.status).toBe(413)
        expect(await oversized.json()).toMatchObject({ error: { code: 'payload_too_large' } })
        expect(h.services.readings.readings('sen-01', {}).readings).toHaveLength(0)
    })
})
