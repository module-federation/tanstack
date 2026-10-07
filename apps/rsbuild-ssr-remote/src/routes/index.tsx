import { createFileRoute } from "@tanstack/react-router";
import StatusCard from "../components/StatusCard";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Rsbuild SSR remote</p>
      <h1>Rspack-built SSR remote.</h1>
      <StatusCard />
    </main>
  );
}
