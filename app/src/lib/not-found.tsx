export function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <img src="/favicon.svg" alt="" className="size-10" />
      <h1 className="heading-6">No page here</h1>
      <p className="body-6 max-w-md text-muted">
        This address doesn't exist. The market is on the home page.
      </p>
      <a href="/" className="btn button-sm mt-2 bg-fg text-bg hover:bg-fg/90">
        Back to the market
      </a>
    </main>
  );
}
