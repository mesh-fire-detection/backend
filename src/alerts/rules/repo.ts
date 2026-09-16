import { and, asc, eq, isNull, or } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { alertRules } from '#src/shared/db/schema'

export type RuleRow = typeof alertRules.$inferSelect
type NewRuleRow = typeof alertRules.$inferInsert
type RuleRowPatch = {
    [K in keyof Omit<NewRuleRow, 'id' | 'ownerId' | 'createdAt'>]?: NewRuleRow[K] | undefined
}

const notDeleted = isNull(alertRules.deletedAt)

export function createRuleRepo(db: Db) {
    return {
        /** All live rules, or only one owner's. */
        list(ownerId?: string): RuleRow[] {
            const where =
                ownerId === undefined
                    ? notDeleted
                    : and(notDeleted, eq(alertRules.ownerId, ownerId))
            return db
                .select()
                .from(alertRules)
                .where(where)
                .orderBy(asc(alertRules.createdAt))
                .all()
        },

        findById(id: string): RuleRow | undefined {
            return db
                .select()
                .from(alertRules)
                .where(and(eq(alertRules.id, id), notDeleted))
                .get()
        },

        /** Enabled rules watching this metric on this device or on all devices. */
        activeFor(deviceId: string, metric: string): RuleRow[] {
            const targetsDevice = or(eq(alertRules.deviceId, deviceId), isNull(alertRules.deviceId))
            return db
                .select()
                .from(alertRules)
                .where(
                    and(
                        notDeleted,
                        eq(alertRules.enabled, true),
                        eq(alertRules.metric, metric),
                        targetsDevice
                    )
                )
                .all()
        },

        insert(row: NewRuleRow): RuleRow {
            return db.insert(alertRules).values(row).returning().get()
        },

        update(id: string, patch: RuleRowPatch): RuleRow | undefined {
            return db
                .update(alertRules)
                .set(patch)
                .where(and(eq(alertRules.id, id), notDeleted))
                .returning()
                .get()
        },
    }
}

export type RuleRepo = ReturnType<typeof createRuleRepo>
