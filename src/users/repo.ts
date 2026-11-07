import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { invites, sessions, subscriptions, users } from '#src/shared/db/schema'

export type UserRow = typeof users.$inferSelect
export type InviteRow = typeof invites.$inferSelect
type NewInviteRow = typeof invites.$inferInsert
export type SubscriptionRow = typeof subscriptions.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
type SubscriptionChange = Partial<Omit<SubscriptionRow, 'userId' | 'createdAt'>> &
    Pick<SubscriptionRow, 'updatedAt'>

export function createUserRepo(db: Db) {
    return {
        list(): UserRow[] {
            return db.select().from(users).orderBy(asc(users.createdAt)).all()
        },

        findById(id: string): UserRow | undefined {
            return db.select().from(users).where(eq(users.id, id)).get()
        },

        findByEmail(email: string): UserRow | undefined {
            return db.select().from(users).where(eq(users.email, email)).get()
        },

        /** A person who cannot sign in yet. Better Auth never creates these; we do. */
        insertSubscriber(row: { id: string; email: string; name: string; at: Date }): void {
            db.insert(users)
                .values({
                    id: row.id,
                    email: row.email,
                    name: row.name,
                    role: 'user',
                    status: 'subscriber',
                    createdAt: row.at,
                    updatedAt: row.at,
                })
                .run()
        },

        rename(id: string, name: string, at: Date): void {
            db.update(users).set({ name, updatedAt: at }).where(eq(users.id, id)).run()
        },

        /** Marks the address as asking to join with nodes its browser connected. */
        markNodeJoinRequested(id: string, at: Date): void {
            db.update(users)
                .set({ nodeJoinRequestedAt: at, updatedAt: at })
                .where(eq(users.id, id))
                .run()
        },

        findSubscription(userId: string): SubscriptionRow | undefined {
            return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get()
        },

        findSubscriptionByTokenHash(tokenHash: string): SubscriptionRow | undefined {
            return db
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.confirmTokenHash, tokenHash))
                .get()
        },

        /** Inserts or changes one person's subscription. Consent is set on insert only. */
        saveSubscription(
            userId: string,
            change: SubscriptionChange,
            consent: Pick<SubscriptionRow, 'source' | 'consentText'>
        ): void {
            db.insert(subscriptions)
                .values({ userId, status: 'unconfirmed', ...consent, ...change })
                .onConflictDoUpdate({ target: subscriptions.userId, set: change })
                .run()
        },

        update(
            id: string,
            patch: { role?: string | undefined; banned?: boolean | undefined; updatedAt: Date }
        ): UserRow | undefined {
            return db.update(users).set(patch).where(eq(users.id, id)).returning().get()
        },

        /** Signs the user out everywhere. Sessions are credentials, not data. */
        deleteSessions(userId: string): void {
            db.delete(sessions).where(eq(sessions.userId, userId)).run()
        },

        /** The user's sessions that have not expired, most recently used first. */
        listSessions(userId: string, now: Date): SessionRow[] {
            return db
                .select()
                .from(sessions)
                .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
                .orderBy(desc(sessions.updatedAt))
                .all()
        },

        /** Ends one of the user's sessions. False if they have none by that id. */
        deleteSession(userId: string, id: string): boolean {
            const result = db
                .delete(sessions)
                .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
                .run()
            return result.changes === 1
        },

        insertInvite(row: NewInviteRow): InviteRow {
            return db.insert(invites).values(row).returning().get()
        },

        findInviteByEmail(email: string): InviteRow | undefined {
            return db.select().from(invites).where(eq(invites.email, email)).get()
        },

        listOpenInvites(): InviteRow[] {
            return db
                .select()
                .from(invites)
                .where(isNull(invites.acceptedAt))
                .orderBy(asc(invites.createdAt))
                .all()
        },

        /**
         * Removes an invite nobody has used. An accepted one is the record of
         * how someone became a member, so it stays. False if there was nothing
         * to remove.
         */
        deleteOpenInvite(id: string): boolean {
            const result = db
                .delete(invites)
                .where(and(eq(invites.id, id), isNull(invites.acceptedAt)))
                .run()
            return result.changes === 1
        },
    }
}

export type UserRepo = ReturnType<typeof createUserRepo>
