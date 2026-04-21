/**
 * `/settings` — default redirect to the first pane.
 *
 * Kept as a no-op server component so Next's typed-routes can still
 * resolve `href="/settings"` targets elsewhere in the app if someone
 * adds one.
 */

import { redirect } from 'next/navigation';

export default function SettingsRootPage() {
  redirect('/settings/household');
}
