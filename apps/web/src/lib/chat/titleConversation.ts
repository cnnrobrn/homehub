import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient, type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { z } from 'zod';

export const CONVERSATION_TITLE_MODEL = 'google/gemma-4-31b-it';

const MAX_TITLE_LENGTH = 60;

const titleSchema = z.object({
  title: z.string().min(1).max(100),
});

export function conversationTitleNeedsGeneration(title: string | null | undefined): boolean {
  const normalized = title?.trim();
  if (!normalized) return true;
  return /^untit(?:l|il)ed$/i.test(normalized);
}

export function normalizeGeneratedConversationTitle(raw: string): string | null {
  let title = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/g, '')
    .trim();

  if (!title || conversationTitleNeedsGeneration(title)) return null;

  if (title.length > MAX_TITLE_LENGTH) {
    const clipped = title.slice(0, MAX_TITLE_LENGTH + 1);
    const lastSpace = clipped.lastIndexOf(' ');
    title = (lastSpace >= 24 ? clipped.slice(0, lastSpace) : clipped.slice(0, MAX_TITLE_LENGTH))
      .replace(/[,:;/-]+$/g, '')
      .trim();
  }

  return title || null;
}

export async function titleConversationFromFirstPrompt(args: {
  supabase: ServiceSupabaseClient;
  modelClient: ModelClient;
  logger: Logger;
  householdId: string;
  conversationId: string;
  firstPrompt: string;
}): Promise<string | null> {
  const result = await args.modelClient.generate({
    task: 'conversation.title',
    household_id: args.householdId as HouseholdId,
    model: CONVERSATION_TITLE_MODEL,
    systemPrompt:
      'You title chat threads for HomeHub assistant Alfred. Return JSON only with shape {"title":"..."}. ' +
      'Use only the member first prompt. Write 3 to 7 specific words, no ending punctuation, max 60 characters. ' +
      'Never return Untitled or a generic label.',
    userPrompt: `First prompt:\n${args.firstPrompt}`,
    schema: titleSchema,
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 48,
    cache: 'off',
  });

  const title = normalizeGeneratedConversationTitle(result.parsed?.title ?? result.text);
  if (!title) {
    args.logger.warn('conversation title generation returned unusable title', {
      household_id: args.householdId,
      conversation_id: args.conversationId,
      model: CONVERSATION_TITLE_MODEL,
    });
    return null;
  }

  const { error } = await args.supabase
    .schema('app')
    .from('conversation')
    .update({ title })
    .eq('id', args.conversationId)
    .eq('household_id', args.householdId);
  if (error) {
    args.logger.warn('conversation title update failed', {
      household_id: args.householdId,
      conversation_id: args.conversationId,
      error: error.message,
    });
    return null;
  }

  return title;
}
