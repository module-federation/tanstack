import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ServerAnswers } from "../components/ServerAnswers";
import { getVisitor, setVisitor, VISITORS, type Visitor } from "../visitor";

// Asks the Rsbuild SSR remote's server who is calling. While this host renders, the call
// goes from this server to the remote's; after client-side navigation, it goes from the
// browser through this host. Either way, start.ts decides which headers the remote gets.
function askWhoIsAsking() {
  return import("tanstack_rsbuild_ssr_remote/serverFunctions")
    .then(({ whoIsAsking }) => whoIsAsking())
    .catch(() => null);
}

export const Route = createFileRoute("/visitor")({
  loader: async () => {
    const [visitor, remote] = await Promise.all([getVisitor(), askWhoIsAsking()]);
    return { remote, visitor };
  },
  component: VisitorPage,
});

function VisitorPage() {
  const { remote, visitor } = Route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const signIn = async (next: Visitor | null) => {
    setPending(true);
    try {
      await setVisitor({ data: { visitor: next } });
      // Runs the loader again in the browser, so the remote is asked through this host.
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Credentials and remote server functions</p>
        <h1>The host decides what a remote sees.</h1>
        <p className="lede">
          The host keeps who is signed in in its own httpOnly cookie. A remote's server function
          calls pass through the host, which forwards no cookies or credentials unless it chooses
          to. This host sends only the visitor's name, in one header.
        </p>
        <div className="visitor-actions" role="group" aria-label="Sign in">
          {VISITORS.map((name) => (
            <button
              aria-pressed={visitor === name}
              disabled={pending}
              key={name}
              onClick={() => void signIn(name)}
              type="button"
            >
              Sign in as {name}
            </button>
          ))}
          <button
            aria-pressed={visitor === null}
            disabled={pending}
            onClick={() => void signIn(null)}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="proof-grid" aria-label="What each server sees">
        <article className="host-card">
          <span className="card-index">01</span>
          <p className="card-label">The host's server</p>
          <dl className="facts">
            <dt>Signed in</dt>
            <dd>{visitor ?? "No one"}</dd>
            <dt>Cookie</dt>
            <dd>example_visitor, httpOnly, this origin only</dd>
          </dl>
        </article>
        <article className="host-card">
          <span className="card-index">02</span>
          <p className="card-label">The remote's server</p>
          <ServerAnswers answers={remote ? [remote.message] : null} />
          <dl className="facts">
            <dt>Cookies received</dt>
            <dd>{remote?.cookies ?? "unknown"}</dd>
          </dl>
        </article>
      </section>
    </main>
  );
}
