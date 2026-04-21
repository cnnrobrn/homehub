/**
 * `/settings/household` — household name + settings JSON.
 *
 * Renders as Server Component for the initial paint (name + settings
 * read from `getHouseholdContext()`), then hands off to the client
 * form for the PATCH submit. Owner-only; adults/children see a
 * read-only banner.
 */

import { HouseholdSettingsForm } from '@/components/settings/HouseholdSettingsForm';
import { getHouseholdContext } from '@/lib/auth/context';

export default async function HouseholdSettingsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const settings =
    (ctx.household.settings as {
      timezone?: string;
      currency?: string;
      week_start?: 'sunday' | 'monday';
    }) ?? {};

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Household</h1>
        <p className="text-sm text-fg-muted">
          Set the name and the baseline preferences every member sees.
        </p>
      </header>

      {ctx.member.role === 'owner' ? (
        <HouseholdSettingsForm
          householdId={ctx.household.id}
          initial={{
            name: ctx.household.name,
            timezone: settings.timezone ?? '',
            currency: settings.currency ?? '',
            weekStart: settings.week_start ?? 'sunday',
          }}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
          Only the household owner can edit these settings.
        </div>
      )}
    </div>
  );
}
