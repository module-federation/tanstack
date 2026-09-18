import { createFileRoute } from "@tanstack/react-router";
import { RemoteCardSlot } from "../components/RemoteCardSlot";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Rsbuild host</p>
      <h1>Rspack host, two remote formats.</h1>
      <p>This TanStack Start app loads both remotes through the browser runtime.</p>
      <div className="remote-grid">
        <RemoteCardSlot
          fallback="Loading the Rsbuild remote…"
          remote="tanstack_rsbuild_remote/StatusCard"
        />
        <RemoteCardSlot
          fallback="Loading the Vite remote…"
          remote="tanstack_vite_remote/StatusCard"
        />
      </div>
    </main>
  );
}
