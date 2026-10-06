import { createFileRoute } from "@tanstack/react-router";
import { lazy, useEffect, useState } from "react";
import { RemoteBoundary } from "../components/RemoteBoundary";

const RemoteStatusCard = lazy(() => import("tanstack_vite_remote/StatusCard"));
const RsbuildStatusCard = lazy(() => import("tanstack_rsbuild_remote/StatusCard"));

export const Route = createFileRoute("/")({
  // An unavailable remote must not fail the route: the boundary below renders a fallback.
  loader: () => import("tanstack_vite_remote/StatusCard").then(() => null).catch(() => null),
  component: Home,
});

function Home() {
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">TanStack Start × Module Federation</p>
        <h1>Two full-stack apps. One React tree.</h1>
        <p className="lede">
          This page belongs to the Vite host on port 3000. The Vite remote on port 3001 renders its
          card on the server; the Rsbuild remote on port 3002 loads in the browser after hydration.
        </p>
      </header>

      <section className="proof-grid" aria-label="Federation example">
        <article className="host-card">
          <span className="card-index">01</span>
          <p className="card-label">Host route</p>
          <h2>Rendered by TanStack Start</h2>
          <p>The route, document shell, and server response come from the host app.</p>
        </article>

        <RemoteBoundary fallback="Loading the remote app…" name="Vite remote">
          <RemoteStatusCard />
        </RemoteBoundary>

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
    <RemoteBoundary fallback="Loading the Rsbuild remote…" name="Rsbuild remote">
      <RsbuildStatusCard />
    </RemoteBoundary>
  );
}
