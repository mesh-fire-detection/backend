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

/** Asking to join. The name is used only if this turns out to be a new person. */
export const JoinSchema = z.object({ email: EmailSchema, name: DisplayNameSchema }).strict()
export type Join = z.infer<typeof JoinSchema>

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
