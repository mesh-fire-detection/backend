import { and, asc, eq, isNull } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { invites, sessions, users } from '#src/shared/db/schema'

export type UserRow = typeof users.$inferSelect
export type InviteRow = typeof invites.$inferSelect
type NewInviteRow = typeof invites.$inferInsert

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

        insertInvite(row: NewInviteRow): InviteRow {
            return db.insert(invites).values(row).returning().get()
        },

        findInviteByTokenHash(tokenHash: string): InviteRow | undefined {
            return db.select().from(invites).where(eq(invites.tokenHash, tokenHash)).get()
        },

        /** Marks an unused invite as used. False if another request got there first. */
        claimInvite(id: string, at: Date): boolean {
            const result = db
                .update(invites)
                .set({ acceptedAt: at })
                .where(and(eq(invites.id, id), isNull(invites.acceptedAt)))
                .run()
            return result.changes === 1
        },

        releaseInvite(id: string): void {
            db.update(invites).set({ acceptedAt: null }).where(eq(invites.id, id)).run()
        },

        setInviteUser(id: string, userId: string): void {
            db.update(invites).set({ acceptedUserId: userId }).where(eq(invites.id, id)).run()
        },
    }
}

export type UserRepo = ReturnType<typeof createUserRepo>
