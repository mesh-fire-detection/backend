import { describe, expect, it } from 'vitest'

import { createPreviewStore } from '#src/shared/email/preview'
import { signInCode } from '#src/shared/email/templates'
import { createHarness } from '#tests/support/harness'

const AT = new Date('2026-06-01T12:00:00.000Z')

/** The store the app would build when no provider key is configured. */
function previewWith(code: string) {
    const store = createPreviewStore('', () => AT)
    return {
        store,
        send: () =>
            store.sender.send(
                signInCode('ranger@example.org', code, 'https://example.org/sign-in', 10)
            ),
    }
}

describe('GET /dev/mail', () => {
    it('shows the messages written locally, so sign-in can be worked on without a key', async () => {
        const { store, send } = previewWith('314159')
        await send()
        const h = createHarness({ devConsole: true, emailPreview: store })

        const response = await h.request('/dev/mail')

        expect(response.status).toBe(200)
        const { messages } = (await response.json()) as {
            messages: { to: string; text: string }[]
        }
        expect(messages[0]?.to).toBe('ranger@example.org')
        expect(messages[0]?.text).toContain('314159')
    })

    it('is absent unless the console is on', async () => {
        const { store, send } = previewWith('314159')
        await send()
        const h = createHarness({ emailPreview: store })

        const response = await h.request('/dev/mail')

        expect(response.status).toBe(404)
    })

    it('is absent when a provider is configured, because there is nothing local to read', async () => {
        const h = createHarness({ devConsole: true })

        const response = await h.request('/dev/mail')

        expect(response.status).toBe(404)
    })
})
