import { z } from 'zod'

import { RoleSchema } from '#src/shared/auth/access'

const EmailSchema = z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase())
export const PasswordSchema = z.string().min(12).max(128)
export const DisplayNameSchema = z.string().trim().min(1).max(80)

export const InviteUserSchema = z.object({ email: EmailSchema, role: RoleSchema }).strict()
export type InviteUser = z.infer<typeof InviteUserSchema>

export const InviteParamsSchema = z.object({ id: z.string().min(1).max(64) })

/**
 * Asking to join. The name is used only if this turns out to be a new person.
 * `withNode` says the browser has connected a node; the nodes themselves stay
 * there until the person is a member (backend#9).
 */
export const JoinSchema = z
    .object({ email: EmailSchema, name: DisplayNameSchema, withNode: z.boolean().default(false) })
    .strict()
export type Join = z.infer<typeof JoinSchema>

export const SubscribeSchema = z.object({ email: EmailSchema }).strict()

export const ConfirmSubscriptionSchema = z.object({ token: z.string().min(1).max(200) }).strict()

export const UpdateSubscriptionSchema = z.object({ subscribed: z.boolean() }).strict()

/** What a member may change about themselves. The address is how they sign in, so it stays. */
export const UpdateMeSchema = z.object({ name: DisplayNameSchema }).strict()

/** The signed-in person as the website's session knows them. */
export const MeSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: RoleSchema,
})
export type Me = z.infer<typeof MeSchema>

export const SessionParamsSchema = z.object({ id: z.string().min(1).max(64) })

/**
 * One place the member is signed in. The token never leaves the server: the
 * id is enough to end it, and only its owner can.
 */
export const SessionSchema = z.object({
    id: z.string(),
    /** The session this request came in on. */
    current: z.boolean(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
    /** When the session was last renewed, which use does at most once a day. */
    lastActiveAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
})
export type Session = z.infer<typeof SessionSchema>

/**
 * A way the member can sign in. The emailed code is always one, since every
 * member has an address, so it cannot be removed and neither can the last way
 * in. The bootstrap admin's password is never offered on the website, so it
 * is not listed.
 */
export const SignInMethodSchema = z.object({
    kind: z.enum(['code', 'google']),
    removable: z.boolean(),
})
export type SignInMethod = z.infer<typeof SignInMethodSchema>

/** Only Google can be removed; see `SignInMethodSchema`. */
export const SignInMethodParamsSchema = z.object({ kind: z.literal('google') })

export const SubscriptionSchema = z.object({
    status: z.enum(['none', 'unconfirmed', 'confirmed', 'unsubscribed']),
})
export type Subscription = z.infer<typeof SubscriptionSchema>

export const UpdateUserSchema = z
    .object({ role: RoleSchema.optional(), disabled: z.boolean().optional() })
    .strict()
    .refine((body) => body.role !== undefined || body.disabled !== undefined, 'nothing to update')
export type UpdateUser = z.infer<typeof UpdateUserSchema>

export const UserParamsSchema = z.object({ id: z.string().min(1).max(64) })

export const UserSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: RoleSchema,
    status: z.enum(['subscriber', 'member']),
    disabled: z.boolean(),
    createdAt: z.iso.datetime(),
})
export type User = z.infer<typeof UserSchema>

/** An address on the allowlist that has not joined yet. */
export const InviteSchema = z.object({
    id: z.string(),
    email: z.string(),
    role: RoleSchema,
    createdAt: z.iso.datetime(),
})
export type Invite = z.infer<typeof InviteSchema>
