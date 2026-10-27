import { and, eq, isNull } from 'drizzle-orm'

import { type Db, transaction } from '#src/shared/db/connection'
import { invites, users } from '#src/shared/db/schema'
import { type Clock } from '#src/shared/time'

/** The one definition of who may sign in or hold a usable session. */
export function isMember(status: unknown, banned: boolean | null | undefined): boolean {
    return status === 'member' && banned !== true
}

/**
 * Who is a member, and how someone becomes one. Every check that decides
 * whether a person may sign in goes through here, so the rule cannot drift
 * between the code mailer, the session and the join flow.
 *
 * One row per person from their first contact. A `subscriber` can never sign
 * in; a `member` can, unless banned. Someone becomes a member by verifying an
 * address that has an unused invite (backend#9). Joining with a node is the
 * other route, and arrives with device registration (#12).
 */
export function createMembership({ db, clock }: { readonly db: Db; readonly clock: Clock }) {
    const findUser = (address: string) =>
        db
            .select({ id: users.id, status: users.status, banned: users.banned })
            .from(users)
            .where(eq(users.email, address))
            .get()

    const findOpenInvite = (address: string) =>
        db
            .select()
            .from(invites)
            .where(and(eq(invites.email, address), isNull(invites.acceptedAt)))
            .get()

    return {
        /** Whether an address may receive a sign-in code. */
        mayReceiveSignInCode(address: string): boolean {
            const user = findUser(address)
            return user !== undefined && isMember(user.status, user.banned)
        },

        /** Whether an address may receive a join code: invited, not yet a member, not banned. */
        mayJoin(address: string): boolean {
            const user = findUser(address)
            const settled = user !== undefined && (user.status === 'member' || user.banned === true)
            return !settled && findOpenInvite(address) !== undefined
        },

        /**
         * Makes the person a member with their invite's role and marks the
         * invite used, together or not at all. False when there is no open
         * invite, which leaves them exactly as they were.
         */
        promote(userId: string): boolean {
            return transaction(db, () => {
                const user = db.select().from(users).where(eq(users.id, userId)).get()
                if (user === undefined || user.status === 'member' || user.banned === true) {
                    return false
                }
                const invite = findOpenInvite(user.email)
                if (invite === undefined) return false

                const now = clock()
                db.update(users)
                    .set({ status: 'member', role: invite.role, updatedAt: now })
                    .where(eq(users.id, userId))
                    .run()
                db.update(invites)
                    .set({ acceptedAt: now, acceptedUserId: userId })
                    .where(eq(invites.id, invite.id))
                    .run()
                return true
            })
        },
    }
}

export type Membership = ReturnType<typeof createMembership>
