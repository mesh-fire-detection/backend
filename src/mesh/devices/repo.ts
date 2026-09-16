import { asc, eq } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { devices } from '#src/shared/db/schema'

export type DeviceRow = typeof devices.$inferSelect
type NewDeviceRow = typeof devices.$inferInsert
/** Undefined fields are left unchanged. */
export type DeviceRowPatch = {
    [K in keyof Omit<NewDeviceRow, 'id' | 'createdAt'>]?: NewDeviceRow[K] | undefined
}

export function createDeviceRepo(db: Db) {
    return {
        list(): DeviceRow[] {
            return db.select().from(devices).orderBy(asc(devices.id)).all()
        },

        listEnabled(): DeviceRow[] {
            return db
                .select()
                .from(devices)
                .where(eq(devices.enabled, true))
                .orderBy(asc(devices.id))
                .all()
        },

        findById(id: string): DeviceRow | undefined {
            return db.select().from(devices).where(eq(devices.id, id)).get()
        },

        findByNodeNum(nodeNum: number): DeviceRow | undefined {
            return db.select().from(devices).where(eq(devices.nodeNum, nodeNum)).get()
        },

        insert(row: NewDeviceRow): DeviceRow {
            return db.insert(devices).values(row).returning().get()
        },

        update(id: string, patch: DeviceRowPatch): DeviceRow | undefined {
            return db.update(devices).set(patch).where(eq(devices.id, id)).returning().get()
        },
    }
}

export type DeviceRepo = ReturnType<typeof createDeviceRepo>
