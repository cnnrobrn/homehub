/**
 * Zod schemas for household-flow inputs.
 *
 * The shapes here are the contract between server actions and this
 * package. Keep them small and unaffected by ambient types — the UI
 * owns its own input-level validation (min-length fields, etc.); we
 * only assert structural validity + the invariants we care about for
 * authorization and DB writes.
 */

import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const segmentSchema = z.enum(['financial', 'food', 'fun', 'social', 'system']);
export const accessSchema = z.enum(['none', 'read', 'write']);
export const roleSchema = z.enum(['owner', 'adult', 'child', 'guest']);

const grantSchema = z.object({
  segment: segmentSchema,
  access: accessSchema,
});

export const createHouseholdInputSchema = z.object({
  userId: uuidSchema,
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
  weekStart: z.enum(['sunday', 'monday']).optional(),
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdInputSchema>;

export const inviteMemberInputSchema = z.object({
  householdId: uuidSchema,
  inviterMemberId: uuidSchema,
  email: z.string().email(),
  role: roleSchema,
  grants: z.array(grantSchema).default([]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>;

export const acceptInvitationInputSchema = z.object({
  token: z.string().min(1),
  userId: uuidSchema,
  displayName: z.string().min(1).max(200).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

export const listHouseholdsInputSchema = z.object({
  userId: uuidSchema,
});
export type ListHouseholdsInput = z.infer<typeof listHouseholdsInputSchema>;

export const listMembersInputSchema = z.object({
  householdId: uuidSchema,
  requestorMemberId: uuidSchema,
});
export type ListMembersInput = z.infer<typeof listMembersInputSchema>;

export const revokeMemberInputSchema = z.object({
  householdId: uuidSchema,
  actorMemberId: uuidSchema,
  targetMemberId: uuidSchema,
});
export type RevokeMemberInput = z.infer<typeof revokeMemberInputSchema>;

export const transferOwnershipInputSchema = z.object({
  householdId: uuidSchema,
  currentOwnerMemberId: uuidSchema,
  newOwnerMemberId: uuidSchema,
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipInputSchema>;

export const previewInvitationInputSchema = z.object({
  token: z.string().min(1),
});
export type PreviewInvitationInput = z.infer<typeof previewInvitationInputSchema>;

export const updateHouseholdInputSchema = z.object({
  householdId: uuidSchema,
  actorMemberId: uuidSchema,
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).optional(),
  weekStart: z.enum(['sunday', 'monday']).optional(),
});
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdInputSchema>;

export const listInvitationsInputSchema = z.object({
  householdId: uuidSchema,
  requestorMemberId: uuidSchema,
});
export type ListInvitationsInput = z.infer<typeof listInvitationsInputSchema>;
