import { asc, eq } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { nodes } from '#src/shared/db/schema'

export type NodeRow = typeof nodes.$inferSelect
type NewNodeRow = typeof nodes.$inferInsert
/** Undefined fields are left unchanged. */
export type NodeRowPatch = {
    [K in keyof Omit<NewNodeRow, 'id' | 'createdAt'>]?: NewNodeRow[K] | undefined
}

export function createNodeRepo(db: Db) {
    return {
        list(): NodeRow[] {
            return db.select().from(nodes).orderBy(asc(nodes.id)).all()
        },

        listEnabled(): NodeRow[] {
            return db
                .select()
                .from(nodes)
                .where(eq(nodes.enabled, true))
                .orderBy(asc(nodes.id))
                .all()
        },

        findById(id: string): NodeRow | undefined {
            return db.select().from(nodes).where(eq(nodes.id, id)).get()
        },

        findByNodeNum(nodeNum: number): NodeRow | undefined {
            return db.select().from(nodes).where(eq(nodes.nodeNum, nodeNum)).get()
        },

        insert(row: NewNodeRow): NodeRow {
            return db.insert(nodes).values(row).returning().get()
        },

        update(id: string, patch: NodeRowPatch): NodeRow | undefined {
            return db.update(nodes).set(patch).where(eq(nodes.id, id)).returning().get()
        },
    }
}

export type NodeRepo = ReturnType<typeof createNodeRepo>
