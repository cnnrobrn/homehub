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

interface NewChatPageProps {
  searchParams?: Promise<{ prompt?: string }>;
}

export default async function NewChatPage({ searchParams }: NewChatPageProps) {
  const ctx = await requireHouseholdContext();
  const params = searchParams ? await searchParams : {};
  const res = await createConversationAction({ householdId: ctx.household.id as string });
  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.error.message}`);
  }
  const prompt = params.prompt?.trim();
  const suffix = prompt ? `?prompt=${encodeURIComponent(prompt)}` : '';
  redirect(`/chat/${res.data.conversationId}${suffix}`);
}
