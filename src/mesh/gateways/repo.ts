import { asc, eq } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { gateways } from '#src/shared/db/schema'

export type GatewayRow = typeof gateways.$inferSelect
type NewGatewayRow = typeof gateways.$inferInsert

export function createGatewayRepo(db: Db) {
    return {
        list(): GatewayRow[] {
            return db.select().from(gateways).orderBy(asc(gateways.nodeId)).all()
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
