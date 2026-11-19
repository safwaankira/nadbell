import type { ErrorComponentProps } from "@tanstack/react-router";

const FALLBACK_MESSAGE = "Something failed while loading. Reload the page to try again.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <h1 className="heading-6">Something went wrong</h1>
      <p className="body-6 max-w-md break-words text-muted">{errorMessage(error)}</p>
    </main>
  );
}
