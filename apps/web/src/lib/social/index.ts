/**
 * Social-segment server-side helpers for the HomeHub web app.
 *
 * All readers are household-scoped, RLS-enforced, and grant-aware.
 * Only import these from Server Components / Server Actions / Route
 * Handlers — never from Client Components.
 */

export {
  hasSocialRead,
  hasSocialWrite,
  type GroupRow,
  type PersonRow,
  type SegmentGrant,
  type SocialAlertRow,
  type SocialSuggestionRow,
  type SocialSummaryRow,
} from './types';

export { listPersons, listPersonsArgsSchema, type PersonListRow } from './listPersons';

export {
  getPersonDetail,
  getPersonDetailArgsSchema,
  type PersonDetail,
  type PersonEpisode,
  type PersonFact,
  type PersonUpcomingEvent,
} from './getPersonDetail';

export {
  getGroupDetail,
  getGroupDetailArgsSchema,
  listGroups,
  listGroupsArgsSchema,
  type GetGroupDetailDeps,
  type GroupDetail,
  type GroupListRow,
  type ListGroupsDeps,
} from './listGroups';

export {
  ALERT_SEVERITIES,
  listSocialAlerts,
  listSocialAlertsArgsSchema,
  type AlertSeverity,
  type ListSocialAlertsArgs,
} from './listSocialAlerts';

export {
  listSocialSuggestions,
  listSocialSuggestionsArgsSchema,
  type ListSocialSuggestionsArgs,
} from './listSocialSuggestions';

export {
  listSocialSummaries,
  listSocialSummariesArgsSchema,
  type ListSocialSummariesArgs,
} from './listSocialSummaries';
