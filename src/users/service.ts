import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { RoleSchema, type Role, type Viewer } from '#src/shared/auth/access'
import { type Auth } from '#src/shared/auth/auth'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'
import { type UserRepo, type UserRow } from '#src/users/repo'
import {
    type AcceptInvite,
    type Invite,
    type InviteUser,
    type UpdateUser,
    type User,
} from '#src/users/schema'

const INVITE_TTL_MS = 7 * 24 * 60 * MS_PER_MINUTE

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

function toUser(row: UserRow): User {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        // Better Auth stores role as free text; anything unexpected gets least privilege.
        role: RoleSchema.catch('user').parse(row.role),
        disabled: row.banned === true,
        createdAt: row.createdAt.toISOString(),
    }
}

export function createUserService(deps: {
    readonly repo: UserRepo
    readonly auth: Auth
    readonly clock: Clock
}) {
    const { repo, auth, clock } = deps

    const createAccount = async (
        email: string,
        name: string,
        password: string,
        role: Role
    ): Promise<User> => {
        if (repo.findByEmail(email) !== undefined) {
            throw new DomainError('conflict', 'An account with that email already exists')
        }
        // Called without request headers, Better Auth treats this as a trusted server call.
        const { user } = await auth.api.createUser({ body: { email, name, password, role } })
        const row = repo.findById(user.id)
        if (row === undefined) throw new Error('created user is missing')
        return toUser(row)
    }

    return {
        list(): User[] {
            return repo.list().map((row) => toUser(row))
        },

        /** Returns the raw token once. Only its hash is stored. */
        invite(input: InviteUser, invitedBy: Viewer): { invite: Invite; token: string } {
            if (repo.findByEmail(input.email) !== undefined) {
                throw new DomainError('conflict', 'An account with that email already exists')
            }
            const token = randomBytes(32).toString('base64url')
            const now = clock()
            const row = repo.insertInvite({
                id: randomUUID(),
                tokenHash: hashToken(token),
                email: input.email,
                role: input.role,
                invitedById: invitedBy.id,
                expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
                createdAt: now,
            })
            return {
                invite: {
                    id: row.id,
                    email: row.email,
                    role: row.role,
                    expiresAt: row.expiresAt.toISOString(),
                },
                token,
            }
        },

        async acceptInvite(input: AcceptInvite): Promise<User> {
            const now = clock()
            const invite = repo.findInviteByTokenHash(hashToken(input.token))
            // One message for every failure, so tokens cannot be probed.
            const invalid = new DomainError('bad_request', 'Invite is invalid or has expired')
            if (invite === undefined || invite.expiresAt <= now) throw invalid
            if (!repo.claimInvite(invite.id, now)) throw invalid

            try {
                const user = await createAccount(
                    invite.email,
                    input.name,
                    input.password,
                    invite.role
                )
                repo.setInviteUser(invite.id, user.id)
                return user
            } catch (error) {
                repo.releaseInvite(invite.id)
                throw error
            }
        },

        async createAdmin(email: string, name: string, password: string): Promise<User> {
            return createAccount(email.toLowerCase(), name, password, 'admin')
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
