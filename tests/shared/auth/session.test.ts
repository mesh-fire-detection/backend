import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { sessions } from '#src/shared/db/schema'
import { createHarness } from '#tests/support/harness'

const DAY_MS = 24 * 60 * 60 * 1000

describe('session length', () => {
    it('lasts seven days from sign-in (#15 Q18)', async () => {
        const h = createHarness()
        const { id } = await h.signInAs('user')

        const session = h.db.select().from(sessions).where(eq(sessions.userId, id)).get()

        expect(session).toBeDefined()
        const lifetime = (session?.expiresAt.getTime() ?? 0) - (session?.createdAt.getTime() ?? 0)
        // Created and expiry are stamped a moment apart, by the database and by Better Auth.
        expect(Math.abs(lifetime - 7 * DAY_MS)).toBeLessThan(5000)
    })
})
