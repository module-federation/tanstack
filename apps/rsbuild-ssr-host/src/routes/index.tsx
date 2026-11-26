import {
  dedupeRemoteStylesheets,
  getRemoteStylesheets,
  lazyRemote,
} from "@module-federation/tanstack/runtime";
import { createFileRoute } from "@tanstack/react-router";
import { RemoteBoundary } from "../components/RemoteBoundary";
import { ServerAnswers } from "../components/ServerAnswers";

// Unlike React.lazy, lazyRemote loads again after a failure, so a server that hit a remote
// outage renders the remote once it is back.
const RsbuildStatusCard = lazyRemote(() => import("tanstack_rsbuild_ssr_remote/StatusCard"));
const ViteStatusCard = lazyRemote(() => import("tanstack_vite_remote/StatusCard"));
const ViteRouterCard = lazyRemote(() => import("tanstack_vite_remote/RouterCard"));

// Calls the Rsbuild SSR remote's server functions on the server: the remote's container
// sends them to the remote's server, so the answers are in the initial HTML. The POST call
// carries this host's name in its body.
function askRemoteServer() {
  return import("tanstack_rsbuild_ssr_remote/serverFunctions")
    .then(({ getRemoteGreeting, greetHost }) =>
      Promise.all([getRemoteGreeting(), greetHost({ data: { host: "Rsbuild SSR host" } })]),
    )
    .then((answers) => answers.map(({ message }) => message))
    .catch(() => null);
}

export const Route = createFileRoute("/")({
  // Preloading the remotes before render streams their markup inline in the response.
  // An unavailable remote must not fail the route: its boundary renders a fallback.
  loader: async () => {
    const [stylesheets, remoteAnswer] = await Promise.all([
      Promise.all(
        ["tanstack_rsbuild_ssr_remote/StatusCard", "tanstack_vite_remote/StatusCard"].map(
          (specifier) =>
            getRemoteStylesheets(specifier, {
              onError: (error) =>
                console.error(`Failed to resolve stylesheets for ${specifier}`, error),
            }).catch(() => []),
        ),
      ).then((lists) => dedupeRemoteStylesheets(...lists)),
      askRemoteServer(),
      RsbuildStatusCard.preload().catch(() => null),
      ViteStatusCard.preload().catch(() => null),
      ViteRouterCard.preload().catch(() => null),
    ]);
    return { remoteAnswer, stylesheets };
  },
  // The remote markup arrives with the HTML, so its stylesheets must too. Otherwise it stays
  // unstyled until the remote's JavaScript loads.
  head: ({ loaderData }) => ({
    links: loaderData?.stylesheets.map((href) => ({ href, rel: "stylesheet" })),
  }),
  component: Home,
});

function Home() {
  const { remoteAnswer } = Route.useLoaderData();

  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Rsbuild SSR host</p>
        <h1>Server-rendered from Rsbuild and Vite.</h1>
        <p className="lede">
          This TanStack Start server on port 3005 renders every card below before the page reaches
          the browser: the Rsbuild remote (3004) from its async-node container, and the Vite remote
          (3001) from its ES module entry. Answers from the Rsbuild remote's own server arrive with
          the HTML:
        </p>
        <ServerAnswers answers={remoteAnswer} />
      </header>

      <section className="proof-grid" aria-label="Federation example">
        <RemoteBoundary fallback="Loading the Rsbuild SSR remote…" name="Rsbuild SSR remote">
          <RsbuildStatusCard />
        </RemoteBoundary>
        <RemoteBoundary fallback="Loading the Vite remote…" name="Vite remote">
          <ViteStatusCard />
        </RemoteBoundary>
        <RemoteBoundary fallback="Loading the Router-aware remote…" name="Router-aware remote">
          <ViteRouterCard />
        </RemoteBoundary>
        <article className="host-card">
          <span className="card-index">04</span>
          <p className="card-label">Host route</p>
          <h2>Rendered by TanStack Start on Rsbuild</h2>
          <p>
            The document, router, and React come from this host. Stop a remote and reload: its card
            falls back, the others keep working, and it renders again once the remote returns.
          </p>
        </article>
      </section>
    </main>
  );
}
