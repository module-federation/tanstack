import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const RemoteStatusCard = lazy(() => import("tanstack_vite_remote/StatusCard"));
const RsbuildStatusCard = lazy(() => import("tanstack_rsbuild_remote/StatusCard"));

export const Route = createFileRoute("/")({
  loader: () => import("tanstack_vite_remote/StatusCard").then(() => null),
  component: Home,
});

function Home() {
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">TanStack Start × Module Federation</p>
        <h1>Two full-stack apps. One React tree.</h1>
        <p className="lede">
          This page belongs to the Vite host on port 3000. The interactive card below is owned and
          built by a second TanStack Start application on port 3001.
        </p>
      </header>

      <section className="proof-grid" aria-label="Federation example">
        <article className="host-card">
          <span className="card-index">01</span>
          <p className="card-label">Host route</p>
          <h2>Rendered by TanStack Start</h2>
          <p>The route, document shell, and server response come from the host app.</p>
        </article>

        <Suspense fallback={<div className="remote-loading">Loading the remote app…</div>}>
          <RemoteStatusCard />
        </Suspense>

        <RsbuildRemoteSlot />
      </section>
    </main>
  );
}

function RsbuildRemoteSlot() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="remote-loading">Rsbuild remote loads after hydration</div>;

  return (
    <Suspense fallback={<div className="remote-loading">Loading the Rsbuild remote…</div>}>
      <RsbuildStatusCard />
    </Suspense>
  );
}
