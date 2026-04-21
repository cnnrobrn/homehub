/**
 * `/settings/members` — household member + pending-invite management.
 *
 * Loads both lists server-side so the initial render is complete; the
 * interactive pieces (invite form, revoke, transfer) are client islands.
 */

import { listHouseholdsAction } from '@/app/actions/household';
import { listInvitationsAction, listMembersAction } from '@/app/actions/members';
import { InviteForm } from '@/components/settings/InviteForm';
import { MemberList } from '@/components/settings/MemberList';
import { PendingInvitations } from '@/components/settings/PendingInvitations';
import { getHouseholdContext } from '@/lib/auth/context';
import { publicEnv } from '@/lib/env';

export default async function MembersPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const [membersRes, invitesRes, householdsRes] = await Promise.all([
    listMembersAction({ householdId: ctx.household.id }),
    listInvitationsAction({ householdId: ctx.household.id }),
    listHouseholdsAction(),
  ]);

  const members = membersRes.ok ? membersRes.data : [];
  const pending = invitesRes.ok ? invitesRes.data : [];
  // `householdsRes` is currently unused on this page; we keep the call
  // so the action gets exercised and future per-member cross-household
  // summaries can use it without an extra roundtrip.
  void householdsRes;

  const isOwner = ctx.member.role === 'owner';
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-fg-muted">
          {isOwner
            ? 'Invite new members, set segment access, and manage roles.'
            : 'View members and their current segment access.'}
        </p>
      </header>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-lg font-medium">
          Current members
        </h2>
        <MemberList
          householdId={ctx.household.id}
          members={members}
          viewerMemberId={ctx.member.id}
          viewerIsOwner={isOwner}
        />
      </section>

      {isOwner ? (
        <>
          <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
            <h2 id="pending-heading" className="text-lg font-medium">
              Pending invitations
            </h2>
            <PendingInvitations invitations={pending} appUrl={appUrl} />
          </section>

          <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
            <h2 id="invite-heading" className="text-lg font-medium">
              Invite a member
            </h2>
            <InviteForm householdId={ctx.household.id} appUrl={appUrl} />
          </section>
        </>
      ) : null}
    </div>
  );
}
