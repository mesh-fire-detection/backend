import { asc, eq } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { gateways } from '#src/shared/db/schema'

export type GatewayRow = typeof gateways.$inferSelect
type NewGatewayRow = typeof gateways.$inferInsert

export function createGatewayRepo(db: Db) {
    return {
        list(): GatewayRow[] {
            return db.select().from(gateways).orderBy(asc(gateways.deviceId)).all()
        },

        findByDeviceId(deviceId: string): GatewayRow | undefined {
            return db.select().from(gateways).where(eq(gateways.deviceId, deviceId)).get()
        },

        findByMqttUsername(mqttUsername: string): GatewayRow | undefined {
            return db.select().from(gateways).where(eq(gateways.mqttUsername, mqttUsername)).get()
        },

        insert(row: NewGatewayRow): GatewayRow {
            return db.insert(gateways).values(row).returning().get()
        },

        update(
            deviceId: string,
            patch: {
                mqttUsername?: string | undefined
                enabled?: boolean | undefined
                updatedAt: Date
            }
        ): GatewayRow | undefined {
            return db
                .update(gateways)
                .set(patch)
                .where(eq(gateways.deviceId, deviceId))
                .returning()
                .get()
        },
    }
}

export type GatewayRepo = ReturnType<typeof createGatewayRepo>
