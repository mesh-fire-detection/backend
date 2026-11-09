import { asc, gt, lt } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { events } from '#src/shared/db/schema'

export type EventRow = typeof events.$inferSelect
type NewEventRow = typeof events.$inferInsert

export function createEventRepo(db: Db) {
    return {
        insert(row: NewEventRow): void {
            db.insert(events).values(row).run()
        },

        listAfter(afterId: number, limit: number): EventRow[] {
            return db
                .select()
                .from(events)
                .where(gt(events.id, afterId))
                .orderBy(asc(events.id))
                .limit(limit)
                .all()
        },

        /** Deletes events older than `before`; returns how many. */
        deleteBefore(before: Date): number {
            return db.delete(events).where(lt(events.at, before)).run().changes
        },
    }
}

export type EventRepo = ReturnType<typeof createEventRepo>
