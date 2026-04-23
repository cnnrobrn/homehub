import { AppRouteRedirect } from '@/components/AppRouteRedirect';

export default function SignupRedirectPage() {
  return <AppRouteRedirect fallbackPath="/login" />;
}
