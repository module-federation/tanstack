import { useHostName } from "example-host-context";
import { useState } from "react";
import "./StatusCard.css";

export default function StatusCard() {
  const hostName = useHostName();
  const [count, setCount] = useState(0);
  return (
    <article className="remote-card">
      <p className="eyebrow">Federated from Rsbuild</p>
      <h2>One component, either host.</h2>
      <p>This card is built by Rspack and shared with the Vite host.</p>
      <p className="host-name">Host: {hostName}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Remote count {count}
      </button>
    </article>
  );
}
