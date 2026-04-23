import { AppRouteRedirect } from '@/components/AppRouteRedirect';

export default function AuthCallbackRedirectPage() {
  return <AppRouteRedirect fallbackPath="/auth/callback" />;
}
