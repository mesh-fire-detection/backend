import { and, asc, desc, eq, gte, inArray, isNotNull, max, sum } from 'drizzle-orm'

import { type GatewayLinks } from '#src/mesh/nodes/roles'
import { type Db } from '#src/shared/db/connection'
import { events, gateways, notehubEvents, packetsSeen } from '#src/shared/db/schema'

export type GatewayRow = typeof gateways.$inferSelect
type NewGatewayRow = typeof gateways.$inferInsert

export function createGatewayRepo(db: Db) {
    /** When this gateway last delivered over each path; `null` if never. */
    const lastDeliveryByPath = (gatewayId: string): { mqtt: Date | null; notehub: Date | null } => {
        const mqtt = db
            .select({ at: max(packetsSeen.receivedAt) })
            .from(packetsSeen)
            .where(and(eq(packetsSeen.gatewayId, gatewayId), eq(packetsSeen.via, 'mqtt')))
            .get()
        const notehub = db
            .select({ at: max(notehubEvents.receivedAt) })
            .from(notehubEvents)
            .where(eq(notehubEvents.gatewayId, gatewayId))
            .get()
        return { mqtt: mqtt?.at ?? null, notehub: notehub?.at ?? null }
    }

    /** Notehub's network on the gateway's latest event that named one. */
    const latestTransport = (gatewayId: string): string | null =>
        db
            .select({ transport: notehubEvents.transport })
            .from(notehubEvents)
            .where(and(eq(notehubEvents.gatewayId, gatewayId), isNotNull(notehubEvents.transport)))
            .orderBy(desc(notehubEvents.receivedAt))
            .limit(1)
            .get()?.transport ?? null

    return {
        lastDeliveryByPath,

        /** Every registered gateway's paths, deliveries and latest Notehub network. */
        links(): GatewayLinks[] {
            return db
                .select()
                .from(gateways)
                .orderBy(asc(gateways.nodeId))
                .all()
                .map((row) => {
                    const last = lastDeliveryByPath(row.nodeId)
                    return {
                        nodeId: row.nodeId,
                        mqtt: row.mqttUsername !== null,
                        notecard: row.notecardUid !== null,
                        lastMqttAt: last.mqtt,
                        lastNotehubAt: last.notehub,
                        notehubTransport: latestTransport(row.nodeId),
                    }
                })
        },

        list(): GatewayRow[] {
            return db.select().from(gateways).orderBy(asc(gateways.nodeId)).all()
        },

        /**
         * Every enabled gateway and when it last delivered a packet, over MQTT
         * or Notehub; `null` if it never has. Each lookup uses the gateway's
         * index, so this stays cheap as packets accumulate.
         */
        lastDeliveries(): { gatewayId: string; lastAt: Date | null }[] {
            const lastOf = (table: typeof packetsSeen | typeof notehubEvents, gatewayId: string) =>
                db
                    .select({ at: max(table.receivedAt) })
                    .from(table)
                    .where(eq(table.gatewayId, gatewayId))
                    .get()?.at ?? null
            return db
                .select({ gatewayId: gateways.nodeId })
                .from(gateways)
                .where(eq(gateways.enabled, true))
                .all()
                .map(({ gatewayId }) => {
                    const times = [lastOf(packetsSeen, gatewayId), lastOf(notehubEvents, gatewayId)]
                        .filter((at): at is Date => at !== null)
                        .map((at) => at.getTime())
                    return {
                        gatewayId,
                        lastAt: times.length === 0 ? null : new Date(Math.max(...times)),
                    }
                })
        },

        /**
         * Refused deliveries counted against a gateway since `since`. MQTT
         * rejections name the gateway by mesh ID, since it may not be
         * registered; Notehub ones by node ID, so both are passed.
         */
        rejectionsSince(subjectIds: readonly string[], since: Date): number {
            const row = db
                .select({ total: sum(events.count) })
                .from(events)
                .where(
                    and(
                        inArray(events.type, ['ingest.rejected', 'notehub.rejected']),
                        eq(events.subjectKind, 'gateway'),
                        inArray(events.subjectId, [...subjectIds]),
                        gte(events.at, since)
                    )
                )
                .get()
            return Number(row?.total ?? 0)
        },

        findByNodeId(nodeId: string): GatewayRow | undefined {
            return db.select().from(gateways).where(eq(gateways.nodeId, nodeId)).get()
        },

        findByMqttUsername(mqttUsername: string): GatewayRow | undefined {
            return db.select().from(gateways).where(eq(gateways.mqttUsername, mqttUsername)).get()
        },

        findByNotecardUid(notecardUid: string): GatewayRow | undefined {
            return db.select().from(gateways).where(eq(gateways.notecardUid, notecardUid)).get()
        },

        findByNotehubTokenHash(tokenHash: string): GatewayRow | undefined {
            return db.select().from(gateways).where(eq(gateways.notehubTokenHash, tokenHash)).get()
        },

        delete(nodeId: string): boolean {
            return (
                db.delete(gateways).where(eq(gateways.nodeId, nodeId)).returning().all().length > 0
            )
        },

        insert(row: NewGatewayRow): GatewayRow {
            return db.insert(gateways).values(row).returning().get()
        },

        update(
            nodeId: string,
            patch: {
                mqttUsername?: string | null | undefined
                notecardUid?: string | null | undefined
                notehubTokenHash?: string | null | undefined
                enabled?: boolean | undefined
                updatedAt: Date
            }
        ): GatewayRow | undefined {
            return db
                .update(gateways)
                .set(patch)
                .where(eq(gateways.nodeId, nodeId))
                .returning()
                .get()
        },
    }
}

export type GatewayRepo = ReturnType<typeof createGatewayRepo>
