import { z } from 'zod';
import { email, requiredText, uuid } from './common';
import { ROLE_KEYS } from '../constants/permissions';

/**
 * Password policy: length over composition rules (NIST-style). 12 chars minimum,
 * rejected if it is trivially the user's email local part.
 */
export const password = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'That is longer than 200 characters')
  .refine((v) => v.trim().length === v.length, 'Password cannot start or end with a space');

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, 'Enter your password').max(200),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email }).strict();
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: requiredText(200, 'Reset token'),
    password,
  })
  .strict();
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: password,
  })
  .strict()
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const acceptInvitationSchema = z
  .object({
    token: requiredText(200, 'Invitation token'),
    fullName: requiredText(160, 'Full name'),
    password,
  })
  .strict();
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const roleKeySchema = z.enum(ROLE_KEYS);

/** Response payloads (documented here so the web app derives its types from one place). */
export const sessionUserSchema = z.object({
  id: uuid,
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  status: z.string(),
  role: z.object({
    id: uuid,
    key: z.string(),
    name: z.string(),
  }),
  permissions: z.array(z.string()),
  firm: z.object({
    id: uuid,
    name: z.string(),
    slug: z.string(),
    status: z.string(),
  }),
  lastLoginAt: z.string().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
  user: sessionUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
