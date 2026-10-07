import { getRemoteStylesheets, lazyRemote } from "@module-federation/tanstack/runtime";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RemoteBoundary } from "../components/RemoteBoundary";

// Unlike React.lazy, lazyRemote loads again after a failure, so a server that hit a remote
// outage renders the remote once it is back.
const RemoteStatusCard = lazyRemote(() => import("tanstack_vite_remote/StatusCard"));
const RsbuildStatusCard = lazyRemote(() => import("tanstack_rsbuild_remote/StatusCard"));
const RsbuildSsrStatusCard = lazyRemote(() => import("tanstack_rsbuild_ssr_remote/StatusCard"));

// Manifests of the remotes this route renders on the server.
const serverRenderedManifests = [
  "http://127.0.0.1:3001/mf-manifest.json",
  "http://127.0.0.1:3004/mf-manifest.json",
];

export const Route = createFileRoute("/")({
  // Loading the server-rendered remotes before render puts their markup in the response.
  // An unavailable remote must not fail the route: its boundary renders a fallback.
  loader: async () => {
    const [stylesheets] = await Promise.all([
      Promise.all(
        serverRenderedManifests.map((manifest) =>
          getRemoteStylesheets(manifest, "./StatusCard").catch(() => []),
        ),
      ).then((lists) => lists.flat()),
      import("tanstack_vite_remote/StatusCard").catch(() => null),
      import("tanstack_rsbuild_ssr_remote/StatusCard").catch(() => null),
    ]);
    return { stylesheets };
  },
  // The remote markup arrives with the HTML, so its stylesheets must too. Otherwise it stays
  // unstyled until the remote's JavaScript loads.
  head: ({ loaderData }) => ({
    links: loaderData?.stylesheets.map((href) => ({ href, rel: "stylesheet" })),
  }),
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

        <RemoteBoundary fallback="Loading the Rsbuild SSR remote…" name="Rsbuild SSR remote">
          <RsbuildSsrStatusCard />
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
