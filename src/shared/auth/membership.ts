import { and, eq, isNull } from 'drizzle-orm'

import { type Db, transaction } from '#src/shared/db/connection'
import { invites, subscriptions, users } from '#src/shared/db/schema'
import { type Clock } from '#src/shared/time'

/**
 * The words the join form shows next to its button, recorded as the consent
 * for the updates joining signs someone up to. Keep in step with the website.
 */
const JOIN_CONSENT =
    'Joining also signs you up for occasional project updates. You can stop them at any time.'

/**
 * Recorded for a member enrolled without seeing the join form: the bootstrap
 * admin, an account an admin created, or a member from before this rule.
 * Members get updates unless they turn them off.
 */
const DEFAULT_CONSENT = 'Members get project updates by default.'

const CONSENT = { join: JOIN_CONSENT, default: DEFAULT_CONSENT } as const

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
 * address that is eligible to join (backend#9): one an admin invited, or one
 * that asked to join with nodes its browser connected.
 */
export function createMembership({ db, clock }: { readonly db: Db; readonly clock: Clock }) {
    const findUser = (address: string) =>
        db
            .select({
                id: users.id,
                status: users.status,
                banned: users.banned,
                nodeJoinRequestedAt: users.nodeJoinRequestedAt,
            })
            .from(users)
            .where(eq(users.email, address))
            .get()

    const findOpenInvite = (address: string) =>
        db
            .select()
            .from(invites)
            .where(and(eq(invites.email, address), isNull(invites.acceptedAt)))
            .get()

    /**
     * Members get updates by default, already confirmed: the join code, or the
     * admin who made the account, vouches for the address. Unsubscribing stands.
     */
    const enroll = (userId: string, now: Date, source: keyof typeof CONSENT) => {
        const existing = db
            .select({ status: subscriptions.status })
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId))
            .get()
        if (existing?.status === 'unsubscribed') return
        const confirmed = {
            status: 'confirmed' as const,
            confirmTokenHash: null,
            confirmedAt: now,
            updatedAt: now,
        }
        if (existing === undefined) {
            db.insert(subscriptions)
                .values({ userId, source, consentText: CONSENT[source], ...confirmed })
                .run()
        } else {
            db.update(subscriptions).set(confirmed).where(eq(subscriptions.userId, userId)).run()
        }
    }

    return {
        /**
         * For an account Better Auth just created as a member — the bootstrap
         * admin, or one an admin made — so no member starts without updates.
         */
        enrollByDefault(userId: string): void {
            enroll(userId, clock(), 'default')
        },

        /** Whether an address may receive a sign-in code. */
        mayReceiveSignInCode(address: string): boolean {
            const user = findUser(address)
            return user !== undefined && isMember(user.status, user.banned)
        },

        /**
         * Whether an address may receive a join code: not yet a member, not
         * banned, and either invited or asking with nodes it connected.
         */
        mayJoin(address: string): boolean {
            const user = findUser(address)
            return user !== undefined && (user.status === 'member' || user.banned === true)
                ? false
                : user?.nodeJoinRequestedAt != null || findOpenInvite(address) !== undefined
        },

        /**
         * Makes the person a member and subscribes them, together or not at
         * all. An invite sets their role and is marked used; a node request
         * makes them a `user`. False when they are not eligible, which leaves
         * them exactly as they were.
         */
        promote(userId: string): boolean {
            return transaction(db, () => {
                const user = db.select().from(users).where(eq(users.id, userId)).get()
                if (user === undefined || user.status === 'member' || user.banned === true) {
                    return false
                }
                const invite = findOpenInvite(user.email)
                if (invite === undefined && user.nodeJoinRequestedAt === null) return false

                const now = clock()
                db.update(users)
                    .set({
                        status: 'member',
                        role: invite?.role ?? 'user',
                        nodeJoinRequestedAt: null,
                        updatedAt: now,
                    })
                    .where(eq(users.id, userId))
                    .run()
                if (invite !== undefined) {
                    db.update(invites)
                        .set({ acceptedAt: now, acceptedUserId: userId })
                        .where(eq(invites.id, invite.id))
                        .run()
                }
                enroll(userId, now, 'join')
                return true
            })
        },
    }
}

export type Membership = ReturnType<typeof createMembership>
