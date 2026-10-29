import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { RoleSchema, type Viewer } from '#src/shared/auth/access'
import { type Auth } from '#src/shared/auth/auth'
import { isMember, type Membership } from '#src/shared/auth/membership'
import { type EmailService } from '#src/shared/email/service'
import { confirmSubscription } from '#src/shared/email/templates'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'
import { type InviteRow, type MemberNodeRow, type UserRepo, type UserRow } from '#src/users/repo'
import {
    type Invite,
    type InviteUser,
    type Join,
    type Me,
    type MemberNode,
    type NodeInput,
    type Subscription,
    type UpdateUser,
    type User,
} from '#src/users/schema'

/**
 * The words beside each way of subscribing, recorded as the consent given.
 * Keep in step with the website's footer and account page.
 */
const FOOTER_CONSENT =
    'Occasional project updates by email. Confirm by the link we send; stop any time.'
const ACCOUNT_CONSENT = 'Send me occasional project updates by email.'

/** A second confirmation within a day sends nothing new: each one spends an email. */
const CONFIRM_RESEND_MS = 24 * 60 * MS_PER_MINUTE
const CONFIRM_TTL_MS = 7 * 24 * 60 * MS_PER_MINUTE

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

function toUser(row: UserRow): User {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        // Better Auth stores role as free text; anything unexpected gets least privilege.
        role: RoleSchema.catch('user').parse(row.role),
        status: row.status,
        disabled: row.banned === true,
        createdAt: row.createdAt.toISOString(),
    }
}

function toMemberNode(row: MemberNodeRow): MemberNode {
    return {
        nodeNum: row.nodeNum,
        name: row.name,
        hardware: row.hardware,
        firmware: row.firmware,
        connectedAt: row.connectedAt?.toISOString() ?? null,
        addedAt: row.addedAt.toISOString(),
    }
}

function toInvite(row: InviteRow): Invite {
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
    }
}

export function createUserService(deps: {
    readonly repo: UserRepo
    readonly auth: Auth
    readonly membership: Membership
    readonly email: EmailService
    /** The website's origin, for the confirmation link. */
    readonly siteUrl: string
    readonly clock: Clock
}) {
    const { repo, auth, membership, email, siteUrl, clock } = deps

    /** Asks Better Auth for a code; the code mailer decides whether it is sent. */
    const sendCode = async (address: string, type: 'sign-in' | 'email-verification') => {
        // Called without request headers, Better Auth treats this as a trusted server call.
        await auth.api.sendVerificationOTP({ body: { email: address, type } })
    }

    /** The person's row, created as a subscriber if this is their first contact. */
    const ensurePerson = (address: string, name: string, now: Date): UserRow => {
        const existing = repo.findByEmail(address)
        if (existing !== undefined) return existing
        repo.insertSubscriber({ id: randomUUID(), email: address, name, at: now })
        const row = repo.findByEmail(address)
        if (row === undefined) throw new Error('inserted subscriber is missing')
        return row
    }

    const mySubscription = (userId: string): Subscription => ({
        status: repo.findSubscription(userId)?.status ?? 'none',
    })

    const myNodes = (userId: string): MemberNode[] =>
        repo.listNodes(userId).map((row) => toMemberNode(row))

    return {
        list(): User[] {
            return repo.list().map((row) => toUser(row))
        },

        /** Puts an address on the allowlist. Nothing is emailed; the person asks to join. */
        invite(input: InviteUser, invitedBy: Viewer): { invite: Invite } {
            const existing = repo.findByEmail(input.email)
            if (existing?.status === 'member') {
                throw new DomainError('conflict', 'That address is already a member')
            }
            if (repo.findInviteByEmail(input.email) !== undefined) {
                throw new DomainError('conflict', 'That address is already invited')
            }
            const row = repo.insertInvite({
                id: randomUUID(),
                email: input.email,
                role: input.role,
                invitedById: invitedBy.id,
                createdAt: clock(),
            })
            return { invite: toInvite(row) }
        },

        listInvites(): Invite[] {
            return repo.listOpenInvites().map((row) => toInvite(row))
        },

        removeInvite(id: string): void {
            if (!repo.deleteOpenInvite(id)) throw notFound('Invite')
        },

        /**
         * Answers every address the same way, and sends at most one code: a
         * join code to an address eligible to join, a sign-in code to someone
         * who is already a member, and nothing to anyone else.
         *
         * Eligible means invited, or asking with nodes the browser connected —
         * a claim the website cannot prove, accepted on purpose so a builder
         * can join at their bench (backend#9). The address gets its row now,
         * as a subscriber, because Better Auth verifies only addresses it can
         * find; it cannot sign in until the code makes it a member.
         */
        async join(input: Join): Promise<void> {
            const existing = repo.findByEmail(input.email)
            if (existing !== undefined && isMember(existing.status, existing.banned)) {
                // Same kind of code as a newcomer's, so the join page can take
                // it; verifying it just signs the member in (auth/auth.ts).
                await sendCode(input.email, 'email-verification')
                return
            }
            if (existing?.banned === true || (!input.withNode && !membership.mayJoin(input.email)))
                return

            const now = clock()
            const person = ensurePerson(input.email, input.name, now)
            // A subscriber joining names themselves now; the footer form never asked.
            repo.rename(person.id, input.name, now)
            if (input.withNode) repo.markNodeJoinRequested(person.id, now)
            await sendCode(input.email, 'email-verification')
        },

        /**
         * Footer sign-up. Answers every address the same way. Sends a
         * confirmation link and nothing else until it is used; asking again
         * within a day sends nothing new, and a confirmed address is left alone.
         */
        async subscribe(address: string): Promise<void> {
            const now = clock()
            const known = repo.findByEmail(address)
            if (known?.banned === true) return
            const person = known ?? ensurePerson(address, '', now)
            const current = repo.findSubscription(person.id)
            if (current?.status === 'confirmed') return
            const recentlySent =
                current?.status === 'unconfirmed' &&
                current.confirmSentAt !== null &&
                now.getTime() - current.confirmSentAt.getTime() < CONFIRM_RESEND_MS
            if (recentlySent) return

            const token = randomBytes(32).toString('base64url')
            const consent = { source: 'footer', consentText: FOOTER_CONSENT } as const
            repo.saveSubscription(
                person.id,
                {
                    status: 'unconfirmed',
                    ...consent,
                    confirmTokenHash: hashToken(token),
                    confirmSentAt: now,
                    updatedAt: now,
                },
                consent
            )
            const link = `${siteUrl}/subscribe/confirm?token=${encodeURIComponent(token)}`
            await email.send(confirmSubscription(address, link))
        },

        /** From the link in the confirmation email. Works once, for a week. */
        confirmSubscription(token: string): void {
            const now = clock()
            const current = repo.findSubscriptionByTokenHash(hashToken(token))
            const usable =
                current?.status === 'unconfirmed' &&
                current.confirmSentAt !== null &&
                now.getTime() - current.confirmSentAt.getTime() < CONFIRM_TTL_MS
            if (current === undefined || !usable) {
                throw new DomainError(
                    'bad_request',
                    'This link is invalid or has already been used'
                )
            }
            repo.saveSubscription(
                current.userId,
                { status: 'confirmed', confirmTokenHash: null, confirmedAt: now, updatedAt: now },
                current
            )
        },

        mySubscription,

        /** A member renaming themselves. Their address and role are not theirs to change. */
        renameMe(userId: string, name: string): Me {
            repo.rename(userId, name, clock())
            const row = repo.findById(userId)
            if (row === undefined) throw notFound('User')
            const user = toUser(row)
            return { id: user.id, name: user.name, email: user.email, role: user.role }
        },

        /**
         * A signed-in member turning updates on or off. On needs no
         * confirmation email: their address was proven when they joined.
         */
        setMySubscription(userId: string, subscribed: boolean): Subscription {
            const now = clock()
            const consent = { source: 'account', consentText: ACCOUNT_CONSENT } as const
            const change = subscribed
                ? {
                      status: 'confirmed' as const,
                      ...consent,
                      confirmTokenHash: null,
                      confirmedAt: now,
                      updatedAt: now,
                  }
                : {
                      status: 'unsubscribed' as const,
                      confirmTokenHash: null,
                      unsubscribedAt: now,
                      updatedAt: now,
                  }
            repo.saveSubscription(userId, change, consent)
            return mySubscription(userId)
        },

        myNodes,

        /** Nodes the member's browser connected. Adding one already there refreshes it. */
        addMyNodes(userId: string, nodes: readonly NodeInput[]): MemberNode[] {
            repo.upsertNodes(
                userId,
                nodes.map((node) => ({
                    id: randomUUID(),
                    nodeNum: node.nodeNum,
                    name: node.name,
                    hardware: node.hardware,
                    firmware: node.firmware,
                    connectedAt: node.connectedAt === null ? null : new Date(node.connectedAt),
                }))
            )
            return myNodes(userId)
        },

        async createAdmin(address: string, name: string, password: string): Promise<User> {
            const lowered = address.toLowerCase()
            if (repo.findByEmail(lowered) !== undefined) {
                throw new DomainError('conflict', 'An account with that email already exists')
            }
            // Called without request headers, Better Auth treats this as a trusted server call.
            const { user } = await auth.api.createUser({
                body: { email: lowered, name, password, role: 'admin' },
            })
            const row = repo.findById(user.id)
            if (row === undefined) throw new Error('created user is missing')
            return toUser(row)
        },

        update(id: string, input: UpdateUser, actor: Viewer): User {
            if (id === actor.id) {
                throw new DomainError('forbidden', 'You cannot change your own role or access')
            }
            if (repo.findById(id) === undefined) throw notFound('User')

            const row = repo.update(id, {
                role: input.role,
                banned: input.disabled,
                updatedAt: clock(),
            })
            if (row === undefined) throw notFound('User')
            if (input.disabled === true) repo.deleteSessions(id)
            return toUser(row)
        },
    }
}

export type UserService = ReturnType<typeof createUserService>
