import { z } from 'zod'

/**
 * Every kind of event, with its severity. A type decides its severity, so two
 * places can never report the same thing differently. Fire-rule alerts are not
 * here: they belong to the people on a node, not to admins (#36).
 */
export const EVENT_SEVERITY = {
    // Server
    'server.started': 'info',
    'server.stopping': 'info',
    'job.failed': 'error',
    'http.failed': 'error',
    'email.failed': 'error',
    'alerts.evaluation_failed': 'error',
    // Broker and ingest
    'broker.connected': 'info',
    'broker.disconnected': 'error',
    'broker.subscribe_failed': 'error',
    'ingest.rejected': 'warn',
    'ingest.dropped': 'warn',
    'ingest.failed': 'error',
    'notehub.rejected': 'warn',
    'notehub.storage_failed': 'error',
    // Network
    'gateway.silent': 'warn',
    'gateway.back': 'info',
    'node.offline': 'warn',
    'node.back': 'info',
    'node.battery_low': 'warn',
    'node.battery_ok': 'info',
    // Audit
    'member.joined': 'info',
    'account.deleted': 'info',
    'admin.created': 'warn',
    'invite.created': 'info',
    'invite.removed': 'info',
    'user.role_changed': 'warn',
    'user.disabled': 'warn',
    'user.enabled': 'info',
    'node.registered': 'info',
    'gateway.registered': 'info',
} as const satisfies Record<string, 'info' | 'warn' | 'error'>

export type EventType = keyof typeof EVENT_SEVERITY

const EVENT_TYPES = Object.keys(EVENT_SEVERITY) as [EventType, ...EventType[]]

const SubjectKindSchema = z.enum(['gateway', 'node', 'user'])

/** What an event is about. A gateway nobody registered is named by its mesh ID. */
export type Subject = { readonly kind: z.infer<typeof SubjectKindSchema>; readonly id: string }

/** Small facts: numbers, booleans, and codes. Never free text: the event log stores any string that is not a code as `invalid`. */
export type EventDetails = Readonly<Record<string, string | number | boolean | null>>

const DetailSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const EventSchema = z.object({
    id: z.number().int(),
    at: z.iso.datetime(),
    severity: z.enum(['info', 'warn', 'error']),
    type: z.enum(EVENT_TYPES),
    subject: z.object({ kind: SubjectKindSchema, id: z.string() }).nullable(),
    count: z.number().int(),
    details: z.record(z.string(), DetailSchema),
})
export type Event = z.infer<typeof EventSchema>

export const EventsQuerySchema = z
    .object({
        /** The last id the reader has seen; events after it come back oldest first. */
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .strict()
export type EventsQuery = z.infer<typeof EventsQuerySchema>
