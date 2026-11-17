import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { HostContext } from "example-host-context";
import type { ReactNode } from "react";
import stylesHref from "../styles.css?url";

const HOST_NAME = "Rsbuild SSR host";

export const Route = createRootRoute({
  head: () => ({
    links: [{ href: stylesHref, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TanStack Start federation Rsbuild SSR host" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <HostContext.Provider value={HOST_NAME}>
        <nav className="site-nav" aria-label="Host pages">
          <span className="host-badge">{HOST_NAME} · :3005</span>
          <Link to="/" activeOptions={{ exact: true, includeHash: false }}>
            Remotes
          </Link>
          <Link to="/visitor">Visitor</Link>
        </nav>
        <Outlet />
      </HostContext.Provider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
