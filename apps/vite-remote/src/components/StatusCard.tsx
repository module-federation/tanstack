import { useHostName } from "example-host-context";
import { useEffect, useState } from "react";
import "./StatusCard.css";

export default function StatusCard() {
  const hostName = useHostName();
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <article className="remote-card">
      <span className="card-index">02</span>
      <p className="card-label">Federated route module</p>
      <div className="remote-status">
        <span className="status-dot" />
        {hydrated ? "Hydrated on the host" : "Rendered on the server"}
      </div>
      <h2>Owned by the remote app</h2>
      <p>This component crossed an application boundary while React stayed a shared singleton.</p>
      <p className="host-name">Host: {hostName}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Remote count <strong>{count}</strong>
      </button>
    </article>
  );
}
