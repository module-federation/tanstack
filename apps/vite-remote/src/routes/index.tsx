import { createFileRoute } from "@tanstack/react-router";
import StatusCard from "../components/StatusCard";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="remote-page">
      <div>
        <p className="eyebrow">Standalone remote</p>
        <h1>This is a complete TanStack Start app.</h1>
        <p className="lede">
          It owns a route and a server build, then exposes the same component to the host through
          Module Federation.
        </p>
      </div>
      <StatusCard />
    </main>
  );
}
