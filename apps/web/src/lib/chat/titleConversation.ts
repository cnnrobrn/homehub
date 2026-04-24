import { type HouseholdId } from '@homehub/shared';
import { type Logger, type ModelClient, type ServiceSupabaseClient } from '@homehub/worker-runtime';
import { z } from 'zod';

export const CONVERSATION_TITLE_MODEL = 'google/gemma-4-31b-it';

const MAX_TITLE_LENGTH = 60;
const TITLE_WORD_LIMIT = 7;

const TITLE_STOP_WORDS = new Set([
  'a',
  'about',
  'already',
  'am',
  'an',
  'and',
  'are',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'help',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'please',
  'the',
  'this',
  'to',
  'we',
  'what',
  'whats',
  'when',
  'where',
  'who',
  'why',
  'with',
  'you',
]);

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

function normalizeTitleWord(word: string): string {
  return word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
}

function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function fallbackConversationTitleFromPrompt(prompt: string): string | null {
  const words = prompt
    .replace(/^\/[a-z][\w-]*\s+/i, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[(?:node|episode):[0-9a-f-]{36}\]/gi, ' ')
    .replace(/[^a-z0-9' -]+/gi, ' ')
    .split(/\s+/)
    .map(normalizeTitleWord)
    .filter(Boolean);

  const significant = words.filter((word) => !TITLE_STOP_WORDS.has(word.toLowerCase()));
  const picked = (significant.length >= 2 ? significant : words).slice(0, TITLE_WORD_LIMIT);
  const title = picked.map(titleCaseWord).join(' ');
  return normalizeGeneratedConversationTitle(title);
}

export async function updateConversationTitle(args: {
  supabase: ServiceSupabaseClient;
  householdId: string;
  conversationId: string;
  title: string;
  logger: Logger;
}): Promise<boolean> {
  const { error } = await args.supabase
    .schema('app')
    .from('conversation')
    .update({ title: args.title })
    .eq('id', args.conversationId)
    .eq('household_id', args.householdId);
  if (error) {
    args.logger.warn('conversation title update failed', {
      household_id: args.householdId,
      conversation_id: args.conversationId,
      error: error.message,
    });
    return false;
  }

  return true;
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

  const updated = await updateConversationTitle({
    supabase: args.supabase,
    householdId: args.householdId,
    conversationId: args.conversationId,
    title,
    logger: args.logger,
  });
  if (!updated) {
    return null;
  }

  return title;
}
