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

export const AcceptInviteSchema = z
    .object({
        token: z.string().min(1).max(200),
        name: DisplayNameSchema,
        password: PasswordSchema,
    })
    .strict()
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>

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
    disabled: z.boolean(),
    createdAt: z.iso.datetime(),
})
export type User = z.infer<typeof UserSchema>

export const InviteSchema = z.object({
    id: z.string(),
    email: z.string(),
    role: RoleSchema,
    expiresAt: z.iso.datetime(),
})
export type Invite = z.infer<typeof InviteSchema>
