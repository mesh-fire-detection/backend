import { and, eq, gt } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import {
    deviceMetrics,
    devices,
    linkObservations,
    packetsSeen,
    readings,
} from '#src/shared/db/schema'

type NewPacketSeen = typeof packetsSeen.$inferInsert
type NewDeviceMetrics = typeof deviceMetrics.$inferInsert
type NewReading = typeof readings.$inferInsert
type NewLinkObservation = typeof linkObservations.$inferInsert

export type ReportedFields = {
    readonly reportedName?: string | null
    readonly reportedLongitude?: number
    readonly reportedLatitude?: number
    readonly reportedAltitudeM?: number | null
    readonly reportedAt: Date
}

export function createIngestRepo(db: Db) {
    return {
        wasSeenSince(fromNodeNum: number, packetId: number, since: Date): boolean {
            const row = db
                .select({ id: packetsSeen.id })
                .from(packetsSeen)
                .where(
                    and(
                        eq(packetsSeen.fromNodeNum, fromNodeNum),
                        eq(packetsSeen.packetId, packetId),
                        gt(packetsSeen.receivedAt, since)
                    )
                )
                .get()
            return row !== undefined
        },

        insertPacketSeen(row: NewPacketSeen): void {
            db.insert(packetsSeen).values(row).run()
        },

        insertDeviceMetrics(row: NewDeviceMetrics): void {
            db.insert(deviceMetrics).values(row).run()
        },

        insertReadings(rows: readonly NewReading[]): void {
            if (rows.length === 0) return
            db.insert(readings)
                .values([...rows])
                .run()
        },

        insertLinkObservations(rows: readonly NewLinkObservation[]): void {
            if (rows.length === 0) return
            db.insert(linkObservations)
                .values([...rows])
                .run()
        },

        markHeard(deviceId: string, at: Date): void {
            db.update(devices).set({ lastHeardAt: at }).where(eq(devices.id, deviceId)).run()
        },

        updateReported(deviceId: string, fields: ReportedFields): void {
            db.update(devices).set(fields).where(eq(devices.id, deviceId)).run()
        },
    }
}

export type IngestRepo = ReturnType<typeof createIngestRepo>
