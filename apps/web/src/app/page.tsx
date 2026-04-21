/**
 * M0 landing page.
 *
 * A stub that proves the shell boots. @frontend-chat replaces this in M1
 * with the real dashboard composed of segment tiles, alerts, suggestions,
 * and the ask launcher (see `specs/07-frontend/pages.md`).
 */
export default function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-5xl font-semibold tracking-tight text-fg">HomeHub</h1>
        <p className="max-w-md text-base text-fg-muted">
          Household AI control panel — setup in progress.
        </p>
      </div>
      <footer className="text-sm text-fg-muted">
        <a
          href="/api/health"
          className="underline decoration-dotted underline-offset-4 transition hover:text-fg"
        >
          infra liveness: /api/health
        </a>
      </footer>
    </main>
  );
}
