import { useHostName } from "example-host-context";
import { useEffect, useState } from "react";
import { getRemoteGreeting } from "../server-functions";
import "./StatusCard.css";

export default function StatusCard() {
  const hostName = useHostName();
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [answer, setAnswer] = useState<string>();

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <article className="rsbuild-ssr-card">
      <p className="eyebrow">Federated SSR from Rsbuild</p>
      <p className="remote-status">
        {hydrated ? "Hydrated on the host" : "Rendered on the server"}
      </p>
      <h2>Server-rendered by an Rsbuild remote.</h2>
      <p>The host's server loaded this card from the remote's async-node container.</p>
      <p className="host-name">Host: {hostName}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Remote count {count}
      </button>
      <button
        type="button"
        onClick={() => {
          getRemoteGreeting().then(
            ({ message }) => setAnswer(message),
            () => setAnswer("The remote's server did not answer."),
          );
        }}
      >
        Ask the remote's server
      </button>
      {answer ? <p className="remote-answer">{answer}</p> : null}
    </article>
  );
}
