import { createRemoteServerFunctions } from "@module-federation/tanstack/server-functions";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { visitorFromRequest } from "./visitor";

// Sends the Rsbuild SSR remote's server function calls to its server: calls from the
// browser go through this host, and calls made while this host renders go directly.
const remoteServerFunctions = createRemoteServerFunctions({
  remotes: {
    tanstack_rsbuild_ssr_remote: {
      origin: "http://127.0.0.1:3004",
      // No cookie or credential reaches a remote unless the host passes it here. This host
      // tells the remote who is signed in, and keeps its own cookies to itself.
      headers: ({ request }) => {
        const visitor = visitorFromRequest(request);
        return visitor ? { "x-example-visitor": visitor } : undefined;
      },
    },
  },
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    // Custom request middleware replaces Start's default cross-site check for this host's
    // own server functions, so keep it.
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === "serverFn" }),
    createMiddleware().server(
      ({ next, request }) => remoteServerFunctions.handle(request) ?? next(),
    ),
  ],
}));
