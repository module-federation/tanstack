import { useEffect, useState } from "react";
import "./StatusCard.css";

export default function StatusCard() {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <article className="remote-card">
      <p className="eyebrow">Federated SSR from Rsbuild</p>
      <p className="remote-status">
        {hydrated ? "Hydrated on the host" : "Rendered on the server"}
      </p>
      <h2>Server-rendered by an Rsbuild remote.</h2>
      <p>The host's server loaded this card from the remote's async-node container.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Remote count {count}
      </button>
    </article>
  );
}
