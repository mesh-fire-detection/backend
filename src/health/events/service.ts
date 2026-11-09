import { type EventRepo, type EventRow } from '#src/health/events/repo'
import {
    EVENT_SEVERITY,
    type Event,
    type EventDetails,
    EventSchema,
    type EventsQuery,
    type EventType,
    type Subject,
} from '#src/health/events/schema'
import { type Logger } from '#src/shared/logger'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

/** Decided November 8, 2026 (#36): an exception to keeping everything, recorded in SPEC. */
const EVENT_RETENTION_DAYS = 90

/**
 * What a string in an event may look like: an ID, a code, a version, a time.
 * No spaces and no `@`, so a sentence, an email address or a name cannot get
 * in, and neither can text a stranger wrote for the agent that reads this.
 */
const CODE = /^[\w.:/!-]{1,100}$/u

const asCode = (value: string): string => (CODE.test(value) ? value : 'invalid')

const clean = (details: EventDetails | undefined): EventDetails =>
    Object.fromEntries(
        Object.entries(details ?? {}).map(([key, value]) => [
            key,
            typeof value === 'string' ? asCode(value) : value,
        ])
    )

type Options = { readonly subject?: Subject | undefined; readonly details?: EventDetails }

type Tally = {
    readonly type: EventType
    readonly subject: Subject | undefined
    readonly details: EventDetails
    readonly since: Date
    count: number
}

/** When a gateway last delivered anything, over MQTT or Notehub. */
export type GatewayDelivery = { readonly gatewayId: string; readonly lastAt: Date | null }

function toEvent(row: EventRow): Event {
    return EventSchema.parse({
        id: row.id,
        at: row.at.toISOString(),
        severity: row.severity,
        type: row.type,
        subject:
            row.subjectKind === null || row.subjectId === null
                ? null
                : { kind: row.subjectKind, id: row.subjectId },
        count: row.count,
        details: row.details ?? {},
    })
}

/**
 * The event log (#36). Writing to it never throws: a full disk or a bug here
 * must not cost a packet, a sign-in or a request, so a failure goes to the
 * process log instead.
 *
 * Things that repeat — rejected packets, failed requests — are counted in
 * memory with `count` and written as one event per kind by `maintain`, which
 * the scheduled job runs. Counts not yet written are lost if the process dies
 * hard; a normal shutdown writes them.
 */
export function createEventLog(deps: {
    readonly repo: EventRepo
    readonly clock: Clock
    readonly logger: Logger
    /** Every enabled gateway and when it last delivered. */
    readonly gatewayDeliveries: () => readonly GatewayDelivery[]
    /** How long a gateway may deliver nothing before it is silent. */
    readonly silentAfterMin: number
}) {
    const { repo, clock, gatewayDeliveries, silentAfterMin } = deps
    const logger = deps.logger.child({ component: 'events' })
    const tallies = new Map<string, Tally>()
    // Kept in memory, so a gateway still silent after a restart is reported again.
    const silent = new Set<string>()

    const write = (type: EventType, at: Date, count: number, options: Options): void => {
        try {
            repo.insert({
                at,
                severity: EVENT_SEVERITY[type],
                type,
                subjectKind: options.subject?.kind ?? null,
                subjectId: options.subject === undefined ? null : asCode(options.subject.id),
                count,
                details: clean(options.details),
            })
        } catch (error) {
            logger.error({ err: error, type }, 'event not recorded')
        }
    }

    const flush = (now: Date): void => {
        for (const tally of tallies.values()) {
            write(tally.type, now, tally.count, {
                subject: tally.subject,
                details: { ...tally.details, since: tally.since.toISOString() },
            })
        }
        tallies.clear()
    }

    const watchGateways = (now: Date): void => {
        const current = new Set<string>()
        for (const { gatewayId, lastAt } of gatewayDeliveries()) {
            current.add(gatewayId)
            // A gateway that has never delivered is new, not silent.
            if (lastAt === null) continue
            const silentMin = Math.floor((now.getTime() - lastAt.getTime()) / MS_PER_MINUTE)
            const subject = { kind: 'gateway', id: gatewayId } as const
            if (silentMin >= silentAfterMin && !silent.has(gatewayId)) {
                silent.add(gatewayId)
                write('gateway.silent', now, 1, {
                    subject,
                    details: { lastAt: lastAt.toISOString(), silentMin },
                })
            } else if (silentMin < silentAfterMin && silent.has(gatewayId)) {
                silent.delete(gatewayId)
                write('gateway.back', now, 1, {
                    subject,
                    details: { lastAt: lastAt.toISOString() },
                })
            }
        }
        // A disabled or removed gateway is no longer watched.
        for (const gatewayId of silent) if (!current.has(gatewayId)) silent.delete(gatewayId)
    }

    return {
        /** Records one event now. */
        record(type: EventType, options: Options = {}): void {
            write(type, clock(), 1, options)
        },

        /** Counts one occurrence, written with the others like it by `maintain`. */
        count(type: EventType, options: Options = {}): void {
            const details = clean(options.details)
            const key = JSON.stringify([type, options.subject?.kind, options.subject?.id, details])
            const tally = tallies.get(key)
            if (tally === undefined) {
                tallies.set(key, {
                    type,
                    subject: options.subject,
                    details,
                    since: clock(),
                    count: 1,
                })
            } else {
                tally.count += 1
            }
        },

        /**
         * The scheduled part: writes the counts, notices gateways going silent
         * and coming back, and deletes events past their 90 days.
         */
        maintain(now: Date): void {
            flush(now)
            try {
                watchGateways(now)
                repo.deleteBefore(
                    new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * MS_PER_MINUTE)
                )
            } catch (error) {
                logger.error({ err: error }, 'event maintenance failed')
            }
        },

        /** Writes what has been counted, for shutdown. */
        flush(): void {
            flush(clock())
        },

        list(query: EventsQuery): Event[] {
            return repo.listAfter(query.after, query.limit).map((row) => toEvent(row))
        },
    }
}

export type EventLog = ReturnType<typeof createEventLog>
