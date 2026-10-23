import { and, desc, eq, gt, isNotNull } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import {
    devices,
    gateways,
    notehubEvents,
    notehubSamples,
    packetsSeen,
} from '#src/shared/db/schema'

export function createNotehubRepo(db: Db) {
    return {
        event(eventId: string) {
            return db.select().from(notehubEvents).where(eq(notehubEvents.eventId, eventId)).get()
        },
        insertEvent(row: typeof notehubEvents.$inferInsert): void {
            db.insert(notehubEvents).values(row).run()
        },
        insertSample(sourceHash: string, receivedAt: Date): void {
            db.insert(notehubSamples).values({ sourceHash, receivedAt }).onConflictDoNothing().run()
        },
        hasSourceHash(sourceHash: string): boolean {
            return (
                db
                    .select({ id: packetsSeen.id })
                    .from(packetsSeen)
                    .where(eq(packetsSeen.sourceHash, sourceHash))
                    .limit(1)
                    .get() !== undefined
            )
        },
        recentPacket(fromNodeNum: number, packetId: number, since: Date) {
            return db
                .select()
                .from(packetsSeen)
                .where(
                    and(
                        eq(packetsSeen.fromNodeNum, fromNodeNum),
                        eq(packetsSeen.packetId, packetId),
                        gt(packetsSeen.receivedAt, since)
                    )
                )
                .orderBy(desc(packetsSeen.receivedAt))
                .limit(1)
                .get()
        },
        hasCredentials(): boolean {
            return (
                db
                    .select({ id: gateways.deviceId })
                    .from(gateways)
                    .innerJoin(devices, eq(devices.id, gateways.deviceId))
                    .where(
                        and(
                            eq(gateways.enabled, true),
                            eq(devices.enabled, true),
                            isNotNull(gateways.notecardUid),
                            isNotNull(gateways.notehubTokenHash)
                        )
                    )
                    .limit(1)
                    .get() !== undefined
            )
        },
        lastReceivedAt(): Date | null {
            return (
                db
                    .select({ at: notehubEvents.receivedAt })
                    .from(notehubEvents)
                    .orderBy(desc(notehubEvents.receivedAt))
                    .limit(1)
                    .get()?.at ?? null
            )
        },
    }
}

export type NotehubRepo = ReturnType<typeof createNotehubRepo>
