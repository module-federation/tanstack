import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { RemoteBoundary } from "../components/RemoteBoundary";

const RemoteStatusCard = lazy(() => import("tanstack_rsbuild_ssr_remote/StatusCard"));

export const Route = createFileRoute("/")({
  // Loading the remote before render puts its markup in the server response.
  // An unavailable remote must not fail the route: the boundary below renders a fallback.
  loader: () => import("tanstack_rsbuild_ssr_remote/StatusCard").then(() => null).catch(() => null),
  component: Home,
});

function Home() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Rsbuild SSR host</p>
      <h1>Server-rendered across Rsbuild apps.</h1>
      <p>This TanStack Start server renders the remote card before the page reaches the browser.</p>
      <div className="remote-grid">
        <RemoteBoundary fallback="Loading the Rsbuild SSR remote…" name="Rsbuild SSR remote">
          <RemoteStatusCard />
        </RemoteBoundary>
      </div>
    </main>
  );
}
