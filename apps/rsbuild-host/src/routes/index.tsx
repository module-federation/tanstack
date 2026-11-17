import { createFileRoute } from "@tanstack/react-router";
import { RemoteCardSlot } from "../components/RemoteCardSlot";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Rsbuild host · :3003</p>
        <h1>Rspack host, two remote formats.</h1>
        <p className="lede">
          This TanStack Start app renders on its own server, then loads both remotes in the browser
          with <code>loadRemote()</code> after hydration: the Rsbuild remote (3002) and the Vite
          remote (3001). Nothing federated runs on this server.
        </p>
      </header>
      <section className="proof-grid" aria-label="Federation example">
        <RemoteCardSlot
          fallback="Loading the Rsbuild remote…"
          remote="tanstack_rsbuild_remote/StatusCard"
        />
        <RemoteCardSlot
          fallback="Loading the Vite remote…"
          remote="tanstack_vite_remote/StatusCard"
        />
        <RemoteCardSlot
          fallback="Loading the Router-aware remote…"
          remote="tanstack_vite_remote/RouterCard"
        />
        <article className="host-card">
          <span className="card-index">04</span>
          <p className="card-label">Host route</p>
          <h2>Client-only federation</h2>
          <p>
            Remotes resolve on demand (<code>shareStrategy: "loaded-first"</code>), so an offline
            remote neither blocks this page nor its startup: its slot says so and the rest work.
          </p>
        </article>
      </section>
    </main>
  );
}
