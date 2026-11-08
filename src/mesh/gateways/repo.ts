import { asc, eq, max } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { gateways, notehubEvents, packetsSeen } from '#src/shared/db/schema'

export type GatewayRow = typeof gateways.$inferSelect
type NewGatewayRow = typeof gateways.$inferInsert

export function createGatewayRepo(db: Db) {
    return {
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
