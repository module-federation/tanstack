import { createFileRoute } from "@tanstack/react-router";
import StatusCard from "../components/StatusCard";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Rsbuild remote</p>
      <h1>Rspack-built remote.</h1>
      <StatusCard />
    </main>
  );
}
