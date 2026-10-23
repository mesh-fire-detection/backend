import { Hono } from 'hono'

import { access, type AppEnv } from '#src/shared/auth/access'
import { type PreviewStore } from '#src/shared/email/preview'

/** Mounted under the development console, so it shares its `DEV_CONSOLE` gate. */
export const DEV_MAIL_PATH = '/mail'

/**
 * The messages the preview store wrote, newest first, so a developer working
 * on sign-in can read the code without a provider account.
 *
 * This deliberately shows the recipient and the body, which is why it exists
 * only when `DEV_CONSOLE` is on and only when no provider is configured: with
 * a key present there is no preview store and this route is never mounted.
 */
export function devMailRoutes(preview: PreviewStore): Hono<AppEnv> {
    return new Hono<AppEnv>().get('/', access('public'), (c) =>
        c.json({ messages: preview.list() })
    )
}
