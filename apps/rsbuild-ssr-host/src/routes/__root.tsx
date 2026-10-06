import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { HostContext } from "example-host-context";
import type { ReactNode } from "react";
import stylesHref from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    links: [{ href: stylesHref, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <HostContext.Provider value="Rsbuild SSR host">
        <Outlet />
      </HostContext.Provider>
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
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
