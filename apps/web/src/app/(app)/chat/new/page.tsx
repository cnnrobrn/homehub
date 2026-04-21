/**
 * `/chat/new` — create a fresh conversation and redirect.
 *
 * Server Component. Creates an empty `app.conversation` row then
 * redirects to `/chat/[conversationId]`. Kept as its own route so the
 * sidebar "+ new" link can pre-commit an id without a dialog.
 */

import { redirect } from 'next/navigation';

import { createConversationAction } from '@/app/actions/chat';
import { requireHouseholdContext } from '@/lib/auth/context';

export default async function NewChatPage() {
  const ctx = await requireHouseholdContext();
  const res = await createConversationAction({ householdId: ctx.household.id as string });
  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.error.message}`);
  }
  redirect(`/chat/${res.data.conversationId}`);
}
