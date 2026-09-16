import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

import { parseEnv } from '#src/app/env'
import { createRuntime } from '#src/app/runtime'
import { closeDatabase } from '#src/shared/db/connection'
import { createLogger } from '#src/shared/logger'
import { systemClock } from '#src/shared/time'
import { PasswordSchema, DisplayNameSchema } from '#src/users/schema'

/**
 * Creates the first admin, since accounts otherwise only come from invites.
 * Usage: npm run user:create-admin -- --email you@example.org --name "Your Name"
 * The password is read from stdin so it never appears in shell history.
 */
async function main(): Promise<void> {
    const { values } = parseArgs({
        options: { email: { type: 'string' }, name: { type: 'string' } },
    })
    const name = DisplayNameSchema.safeParse(values.name)
    if (values.email === undefined || !name.success) {
        throw new Error('Usage: --email <address> --name <display name>')
    }

    const readline = createInterface({ input: process.stdin, output: process.stderr })
    const password = PasswordSchema.safeParse(await readline.question('Password: '))
    readline.close()
    if (!password.success) throw new Error('Password must be 12 to 128 characters')

    const logger = createLogger('warn')
    const { db, services } = createRuntime({
        env: parseEnv(process.env),
        clock: systemClock,
        logger,
        mqttState: () => 'disabled',
    })
    try {
        const user = await services.users.createAdmin(values.email, name.data, password.data)
        logger.warn({ id: user.id, email: user.email }, 'admin created')
    } finally {
        closeDatabase(db)
    }
}

try {
    await main()
} catch (error) {
    createLogger('info').fatal({ err: error }, 'could not create admin')
    process.exitCode = 1
}
