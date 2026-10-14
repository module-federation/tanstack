import { Link, useNavigate } from "@tanstack/react-router";
import "./StatusCard.css";

export default function RouterCard() {
  const navigate = useNavigate();

  return (
    <article className="remote-card">
      <p className="card-label">Router-aware remote</p>
      <h2>Remote uses the host router</h2>
      <p>
        This exposed component reads the host&apos;s TanStack Router context through a shared router
        runtime.
      </p>
      <p>
        <Link to="/" hash="router-link">
          Remote link
        </Link>
      </p>
      <button type="button" onClick={() => void navigate({ to: "/", hash: "router-navigate" })}>
        Remote navigate
      </button>
    </article>
  );
}
