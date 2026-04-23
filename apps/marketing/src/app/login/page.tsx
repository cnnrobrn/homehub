import { AppRouteRedirect } from '@/components/AppRouteRedirect';

export default function LoginRedirectPage() {
  return <AppRouteRedirect fallbackPath="/login" />;
}
