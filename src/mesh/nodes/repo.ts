import {
    and,
    asc,
    desc,
    eq,
    exists,
    gte,
    inArray,
    isNotNull,
    like,
    max,
    ne,
    or,
    sql,
} from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import {
    gateways,
    linkObservations,
    nodeMembers,
    nodes,
    packetsSeen,
    readings,
    users,
} from '#src/shared/db/schema'

export type NodeRow = typeof nodes.$inferSelect
type NewNodeRow = typeof nodes.$inferInsert
/** Undefined fields are left unchanged. */
export type NodeRowPatch = {
    [K in keyof Omit<NewNodeRow, 'id' | 'createdAt'>]?: NewNodeRow[K] | undefined
}

/** IDs the server assigns: `n-0001`, and wider once past 9999. */
const GENERATED_ID_PREFIX = 'n-'

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

        findByHardwareId(hardwareId: string): NodeRow | undefined {
            return db.select().from(nodes).where(eq(nodes.hardwareId, hardwareId)).get()
        },

        /** The next unused server-assigned ID. Call inside the transaction that inserts it. */
        nextGeneratedId(): string {
            const row = db.get<{ last: number | null }>(sql`
                SELECT max(CAST(substr(id, 3) AS INTEGER)) AS last FROM nodes
                WHERE id GLOB ${`${GENERATED_ID_PREFIX}[0-9]*`}
            `)
            const next = (row.last ?? 0) + 1
            return `${GENERATED_ID_PREFIX}${String(next).padStart(4, '0')}`
        },

        insert(row: NewNodeRow): NodeRow {
            return db.insert(nodes).values(row).returning().get()
        },

        update(id: string, patch: NodeRowPatch): NodeRow | undefined {
            return db.update(nodes).set(patch).where(eq(nodes.id, id)).returning().get()
        },

        /**
         * Nodes with particle or environment readings recorded since `since`.
         * One indexed range lookup per node, so it stays cheap as readings grow.
         */
        sensorNodeIdsSince(since: Date): Set<string> {
            const sensorMetric = or(
                like(readings.metric, 'airQualityMetrics.%'),
                like(readings.metric, 'environmentMetrics.%')
            )
            const sensorReading = db
                .select({ one: sql`1` })
                .from(readings)
                .where(
                    and(
                        eq(readings.nodeId, nodes.id),
                        gte(readings.recordedAt, since),
                        sensorMetric
                    )
                )
            const rows = db.select({ id: nodes.id }).from(nodes).where(exists(sensorReading)).all()
            return new Set(rows.map((row) => row.id))
        },

        /**
         * For every node, the gateways that delivered its packets since `since`
         * and when each last did. A gateway's own packets are left out. One
         * indexed range per gateway, since there are few.
         */
        meshDeliveriesSince(since: Date): { nodeId: string; gatewayId: string; lastAt: Date }[] {
            const gatewayIds = db.select({ id: gateways.nodeId }).from(gateways).all()
            return gatewayIds.flatMap(({ id }) =>
                db
                    .select({
                        nodeId: nodes.id,
                        gatewayId: packetsSeen.gatewayId,
                        lastAt: max(packetsSeen.receivedAt),
                    })
                    .from(packetsSeen)
                    .innerJoin(nodes, eq(nodes.nodeNum, packetsSeen.fromNodeNum))
                    .where(
                        and(
                            eq(packetsSeen.gatewayId, id),
                            gte(packetsSeen.receivedAt, since),
                            ne(nodes.id, id)
                        )
                    )
                    .groupBy(nodes.id)
                    .all()
                    .flatMap((row) => (row.lastAt === null ? [] : [{ ...row, lastAt: row.lastAt }]))
            )
        },

        /** The gateways that delivered one node's packets since `since`, with hops on the latest. */
        deliveriesOf(
            nodeNum: number,
            since: Date
        ): { gatewayId: string; lastAt: Date; hops: number | null }[] {
            const latest = db
                .select({ gatewayId: packetsSeen.gatewayId, lastAt: max(packetsSeen.receivedAt) })
                .from(packetsSeen)
                .where(
                    and(eq(packetsSeen.fromNodeNum, nodeNum), gte(packetsSeen.receivedAt, since))
                )
                .groupBy(packetsSeen.gatewayId)
                .all()
            return latest.flatMap(({ gatewayId, lastAt }) => {
                if (lastAt === null) return []
                const newest = db
                    .select({ hops: packetsSeen.hops })
                    .from(packetsSeen)
                    .where(
                        and(
                            eq(packetsSeen.fromNodeNum, nodeNum),
                            eq(packetsSeen.gatewayId, gatewayId)
                        )
                    )
                    .orderBy(desc(packetsSeen.receivedAt))
                    .limit(1)
                    .get()
                return [{ gatewayId, lastAt, hops: newest?.hops ?? null }]
            })
        },

        /** Who heard whom, involving this node, since `since`, newest first. */
        linksOf(nodeId: string, since: Date) {
            const involves = or(
                eq(linkObservations.fromNodeId, nodeId),
                eq(linkObservations.toNodeId, nodeId)
            )
            return db
                .select()
                .from(linkObservations)
                .where(and(gte(linkObservations.observedAt, since), involves))
                .orderBy(desc(linkObservations.observedAt))
                .all()
        },

        /** Nodes registered as gateways with a Notecard, enabled or not. */
        notecardGatewayIds(): Set<string> {
            const rows = db
                .select({ nodeId: gateways.nodeId })
                .from(gateways)
                .where(isNotNull(gateways.notecardUid))
                .all()
            return new Set(rows.map((row) => row.nodeId))
        },

        listByMember(userId: string): NodeRow[] {
            return db
                .select({ node: nodes })
                .from(nodeMembers)
                .innerJoin(nodes, eq(nodes.id, nodeMembers.nodeId))
                .where(eq(nodeMembers.userId, userId))
                .orderBy(asc(nodeMembers.addedAt), asc(nodes.id))
                .all()
                .map((row) => row.node)
        },

        memberNodeIds(userId: string): Set<string> {
            const rows = db
                .select({ nodeId: nodeMembers.nodeId })
                .from(nodeMembers)
                .where(eq(nodeMembers.userId, userId))
                .all()
            return new Set(rows.map((row) => row.nodeId))
        },

        isMember(nodeId: string, userId: string): boolean {
            return (
                db
                    .select({ nodeId: nodeMembers.nodeId })
                    .from(nodeMembers)
                    .where(and(eq(nodeMembers.nodeId, nodeId), eq(nodeMembers.userId, userId)))
                    .get() !== undefined
            )
        },

        /** The people on these nodes, earliest first. */
        ownersOf(nodeIds: readonly string[]) {
            return db
                .select({
                    nodeId: nodeMembers.nodeId,
                    userId: nodeMembers.userId,
                    name: users.name,
                    addedAt: nodeMembers.addedAt,
                })
                .from(nodeMembers)
                .innerJoin(users, eq(users.id, nodeMembers.userId))
                .where(inArray(nodeMembers.nodeId, [...nodeIds]))
                .orderBy(asc(nodeMembers.addedAt), asc(users.name))
                .all()
        },

        /** Adding someone already on the node changes nothing. */
        addMember(nodeId: string, userId: string, addedAt: Date): void {
            db.insert(nodeMembers).values({ nodeId, userId, addedAt }).onConflictDoNothing().run()
        },
    }
}

export type NodeRepo = ReturnType<typeof createNodeRepo>
