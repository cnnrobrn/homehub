/**
 * Client form for authoring a new household rule.
 *
 * Description is required; the JSON predicate DSL is optional free-form
 * for M3.7-B (structure firms up once the M9 action-executor lands —
 * the server action accepts `.passthrough()` today). JSON parse errors
 * surface as inline form validation without blocking submission if the
 * user wants to save a description-only rule.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';

import { createRuleAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

const schema = z.object({
  description: z.string().min(1, 'description is required').max(2_000),
  predicateDsl: z.string().max(16_000).optional(),
});

type Values = z.infer<typeof schema>;

/**
 * Zod v4 compatible resolver. The shipped `@hookform/resolvers/zod`
 * looks for `.errors` on the thrown error; zod v4 carries them as
 * `.issues`. We shim a tiny resolver that translates issues into the
 * RHF error shape directly.
 */
const resolver: Resolver<Values> = async (values) => {
  const result = schema.safeParse(values);
  if (result.success) {
    return { values: result.data, errors: {} };
  }
  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (path && !errors[path]) {
      errors[path] = { type: issue.code, message: issue.message };
    }
  }
  return { values: {}, errors };
};

export function RuleCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver,
    defaultValues: { description: '', predicateDsl: '' },
  });

  const onSubmit = (values: Values) => {
    let parsedDsl: Record<string, unknown> | undefined;
    if (values.predicateDsl && values.predicateDsl.trim().length > 0) {
      try {
        const parsed = JSON.parse(values.predicateDsl);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setError('predicateDsl', { message: 'must be a JSON object' });
          return;
        }
        parsedDsl = parsed as Record<string, unknown>;
      } catch {
        setError('predicateDsl', { message: 'invalid JSON' });
        return;
      }
    }
    startTransition(async () => {
      const res = await createRuleAction({
        description: values.description.trim(),
        ...(parsedDsl ? { predicateDsl: parsedDsl } : {}),
      });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not create rule',
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: 'Rule created' });
      reset();
      router.refresh();
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-description">Description</Label>
        <Textarea
          id="rule-description"
          rows={3}
          placeholder="When cooking for kids, avoid peanuts."
          aria-invalid={errors.description ? 'true' : 'false'}
          {...register('description')}
        />
        <FormMessage error={errors.description?.message ?? null} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-dsl">Predicate DSL (optional JSON)</Label>
        <Textarea
          id="rule-dsl"
          rows={5}
          placeholder='{"when":{"meal_has_attendee_tag":"kid"},"forbid":{"ingredient":"peanut"}}'
          aria-invalid={errors.predicateDsl ? 'true' : 'false'}
          className="font-mono text-xs"
          {...register('predicateDsl')}
        />
        <p className="text-xs text-fg-muted">
          Free-form JSON object for now. Once the M9 action-executor lands, this will accept a
          structured DSL. Leave blank to rely solely on the description.
        </p>
        <FormMessage error={errors.predicateDsl?.message ?? null} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || isSubmitting}>
          {pending || isSubmitting ? 'Saving…' : 'Add rule'}
        </Button>
      </div>
    </form>
  );
}
