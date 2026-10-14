import { getRemoteStylesheets, lazyRemote } from "@module-federation/tanstack/runtime";
import { createFileRoute } from "@tanstack/react-router";
import { RemoteBoundary } from "../components/RemoteBoundary";

// Unlike React.lazy, lazyRemote loads again after a failure, so a server that hit a remote
// outage renders the remote once it is back.
const RsbuildStatusCard = lazyRemote(() => import("tanstack_rsbuild_ssr_remote/StatusCard"));
const ViteStatusCard = lazyRemote(() => import("tanstack_vite_remote/StatusCard"));
const ViteRouterCard = lazyRemote(() => import("tanstack_vite_remote/RouterCard"));

// Manifests of the remotes this route renders on the server.
const serverRenderedManifests = [
  "http://127.0.0.1:3004/mf-manifest.json",
  "http://127.0.0.1:3001/mf-manifest.json",
];

export const Route = createFileRoute("/")({
  // Loading the remotes before render puts their markup in the server response.
  // An unavailable remote must not fail the route: its boundary renders a fallback.
  loader: async () => {
    const [stylesheets] = await Promise.all([
      Promise.all(
        serverRenderedManifests.map((manifest) =>
          getRemoteStylesheets(manifest, "./StatusCard").catch(() => []),
        ),
      ).then((lists) => lists.flat()),
      import("tanstack_rsbuild_ssr_remote/StatusCard").catch(() => null),
      import("tanstack_vite_remote/StatusCard").catch(() => null),
      import("tanstack_vite_remote/RouterCard").catch(() => null),
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
      <p className="eyebrow">Rsbuild SSR host</p>
      <h1>Server-rendered from Rsbuild and Vite.</h1>
      <p>
        This TanStack Start server renders both remote cards before the page reaches the browser.
      </p>
      <div className="remote-grid">
        <RemoteBoundary fallback="Loading the Rsbuild SSR remote…" name="Rsbuild SSR remote">
          <RsbuildStatusCard />
        </RemoteBoundary>
        <RemoteBoundary fallback="Loading the Vite remote…" name="Vite remote">
          <ViteStatusCard />
        </RemoteBoundary>
        <RemoteBoundary fallback="Loading the Router-aware remote…" name="Router-aware remote">
          <ViteRouterCard />
        </RemoteBoundary>
      </div>
    </main>
  );
}
