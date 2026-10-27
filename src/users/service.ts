import { randomUUID } from 'node:crypto'

import { RoleSchema, type Viewer } from '#src/shared/auth/access'
import { type Auth } from '#src/shared/auth/auth'
import { isMember, type Membership } from '#src/shared/auth/membership'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'
import { type InviteRow, type UserRepo, type UserRow } from '#src/users/repo'
import {
    type Invite,
    type InviteUser,
    type Join,
    type UpdateUser,
    type User,
} from '#src/users/schema'

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
    readonly clock: Clock
}) {
    const { repo, auth, membership, clock } = deps

    /** Asks Better Auth for a code; the code mailer decides whether it is sent. */
    const sendCode = async (email: string, type: 'sign-in' | 'email-verification') => {
        // Called without request headers, Better Auth treats this as a trusted server call.
        await auth.api.sendVerificationOTP({ body: { email, type } })
    }

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
         * Answers every address the same way, and sends at most one code:
         * a join code to an invited address, a sign-in code to someone who is
         * already a member, and nothing to anyone else.
         *
         * An invited address gets its row now, as a subscriber, because Better
         * Auth verifies only addresses it can find. It cannot sign in until the
         * code makes it a member (see `auth/membership.ts`).
         */
        async join(input: Join): Promise<void> {
            const existing = repo.findByEmail(input.email)
            if (existing !== undefined && isMember(existing.status, existing.banned)) {
                await sendCode(input.email, 'sign-in')
                return
            }
            if (!membership.mayJoin(input.email)) return

            const now = clock()
            if (existing === undefined) {
                repo.insertSubscriber({
                    id: randomUUID(),
                    email: input.email,
                    name: input.name,
                    at: now,
                })
            } else {
                // A subscriber joining names themselves now; the footer form never asked.
                repo.rename(existing.id, input.name, now)
            }
            await sendCode(input.email, 'email-verification')
        },

        async createAdmin(email: string, name: string, password: string): Promise<User> {
            const address = email.toLowerCase()
            if (repo.findByEmail(address) !== undefined) {
                throw new DomainError('conflict', 'An account with that email already exists')
            }
            // Called without request headers, Better Auth treats this as a trusted server call.
            const { user } = await auth.api.createUser({
                body: { email: address, name, password, role: 'admin' },
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
