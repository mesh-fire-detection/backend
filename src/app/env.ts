import { z } from 'zod'

const minutes = (fallback: number) => z.coerce.number().int().positive().default(fallback)
const optionalText = z
    .string()
    .optional()
    .transform((value) => (value === '' ? undefined : value))

/**
 * Every setting the app reads from the environment. Nothing else reads
 * `process.env`; add a variable here and to docs/ARCHITECTURE.md together.
 */
const EnvSchema = z
    .object({
        PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
        /** Caddy is the only thing that should reach the app. */
        HOST: z.string().min(1).default('127.0.0.1'),
        LOG_LEVEL: z
            .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
            .default('info'),
        DATABASE_PATH: z.string().min(1).default('data/mesh.db'),

        /** Serves the API console at /dev. Never enable on a public host. */
        DEV_CONSOLE: z.stringbool().default(false),

        /** Leave unset to run without ingest (local development). */
        MQTT_URL: optionalText.pipe(z.url().optional()),
        MQTT_USERNAME: optionalText,
        MQTT_PASSWORD: optionalText,
        MQTT_TOPIC: z
            .string()
            .min(1)
            .refine((topic) => !topic.endsWith('/'), {
                // Unquoted, `#` starts a comment in .env files and is silently cut off.
                message:
                    'must not end with "/"; quote the value in .env, e.g. MQTT_TOPIC="msh/US/2/e/#"',
            })
            .default('msh/US/2/e/#'),
        MESH_CHANNEL_KEY: optionalText,

        AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
        /** Public URL of this API, e.g. https://api.meshfiredetection.org */
        AUTH_URL: z.url(),
        CORS_ORIGIN: z.url(),

        STATUS_DEGRADED_MIN: minutes(30),
        STATUS_OFFLINE_MIN: minutes(120),
        LOW_BATTERY_PCT: z.coerce.number().min(0).max(100).default(20),
        LINK_WINDOW_MIN: minutes(1440),
    })
    .superRefine((env, ctx) => {
        if (env.STATUS_OFFLINE_MIN <= env.STATUS_DEGRADED_MIN) {
            ctx.addIssue({
                code: 'custom',
                path: ['STATUS_OFFLINE_MIN'],
                message: 'must be greater than STATUS_DEGRADED_MIN',
            })
        }
        if (env.MQTT_URL === undefined) return
        const keyBytes = Buffer.from(env.MESH_CHANNEL_KEY ?? '', 'base64').length
        if (keyBytes !== 16 && keyBytes !== 32) {
            ctx.addIssue({
                code: 'custom',
                path: ['MESH_CHANNEL_KEY'],
                message:
                    'required with MQTT_URL: a private base64 AES key of 16 or 32 bytes (default keys are rejected)',
            })
        }
    })

export type Env = z.infer<typeof EnvSchema>

/** Fails fast with a readable list of problems. Never echoes values, which may be secrets. */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
    const result = EnvSchema.safeParse(source)
    if (!result.success) {
        const problems = result.error.issues.map(
            (issue) => `  ✖ ${issue.path.join('.') || '(root)'}: ${issue.message}`
        )
        throw new Error(`Invalid environment:\n${problems.join('\n')}`)
    }
    return result.data
}
