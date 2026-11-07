import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'

import { type Db, transaction } from '#src/shared/db/connection'
import {
    accounts,
    alertRules,
    invites,
    nodeMembers,
    notificationChannels,
    sessions,
    subscriptions,
    users,
    verifications,
} from '#src/shared/db/schema'

export type UserRow = typeof users.$inferSelect
export type InviteRow = typeof invites.$inferSelect
type NewInviteRow = typeof invites.$inferInsert
export type SubscriptionRow = typeof subscriptions.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
type SubscriptionChange = Partial<Omit<SubscriptionRow, 'userId' | 'createdAt'>> &
    Pick<SubscriptionRow, 'updatedAt'>

export function createUserRepo(db: Db) {
    return {
        /** Everyone but those who deleted their account. */
        list(): UserRow[] {
            return db
                .select()
                .from(users)
                .where(isNull(users.deletedAt))
                .orderBy(asc(users.createdAt))
                .all()
        },

        /** Admins other than `id` who can still sign in. */
        countOtherActiveAdmins(id: string): number {
            const notBanned = or(isNull(users.banned), eq(users.banned, false))
            return db
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        ne(users.id, id),
                        eq(users.role, 'admin'),
                        eq(users.status, 'member'),
                        notBanned,
                        isNull(users.deletedAt)
                    )
                )
                .all().length
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

        /** The providers linked to the user, such as `google` or `credential`. */
        listProviders(userId: string): string[] {
            return db
                .select({ providerId: accounts.providerId })
                .from(accounts)
                .where(eq(accounts.userId, userId))
                .all()
                .map((row) => row.providerId)
        },

        /** Unlinks a provider, with its tokens. False if it was not linked. */
        deleteProvider(userId: string, providerId: string): boolean {
            const result = db
                .delete(accounts)
                .where(and(eq(accounts.userId, userId), eq(accounts.providerId, providerId)))
                .run()
            return result.changes > 0
        },

        /**
         * Deletes a person's account, together or not at all. Their row stays,
         * as `placeholder`, because readings, events and alerts point at it.
         * What identified them or let them in goes: name, address, sessions,
         * linked providers, codes in flight and notification targets. They
         * leave their nodes, their rules stop, their updates stop, and the
         * invite they joined with no longer names them.
         */
        erase(id: string, address: string, placeholder: string, at: Date): void {
            transaction(db, () => {
                db.update(users)
                    .set({
                        name: '',
                        email: placeholder,
                        emailVerified: false,
                        image: null,
                        status: 'subscriber',
                        banned: true,
                        banReason: 'deleted',
                        nodeJoinRequestedAt: null,
                        deletedAt: at,
                        updatedAt: at,
                    })
                    .where(eq(users.id, id))
                    .run()
                db.delete(sessions).where(eq(sessions.userId, id)).run()
                db.delete(accounts).where(eq(accounts.userId, id)).run()
                db.delete(verifications)
                    .where(
                        inArray(
                            verifications.identifier,
                            ['sign-in', 'email-verification', 'forget-password'].map(
                                (type) => `${type}-otp-${address}`
                            )
                        )
                    )
                    .run()
                db.delete(notificationChannels).where(eq(notificationChannels.userId, id)).run()
                db.delete(nodeMembers).where(eq(nodeMembers.userId, id)).run()
                db.update(alertRules)
                    .set({ enabled: false, deletedAt: at, updatedAt: at })
                    .where(and(eq(alertRules.ownerId, id), isNull(alertRules.deletedAt)))
                    .run()
                db.update(subscriptions)
                    .set({
                        status: 'unsubscribed',
                        confirmTokenHash: null,
                        unsubscribedAt: at,
                        updatedAt: at,
                    })
                    .where(eq(subscriptions.userId, id))
                    .run()
                db.update(invites)
                    .set({ email: placeholder })
                    .where(eq(invites.acceptedUserId, id))
                    .run()
            })
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
