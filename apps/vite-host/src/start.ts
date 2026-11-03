import { createRemoteServerFunctions } from "@module-federation/tanstack/server-functions";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Sends the Rsbuild SSR remote's server function calls to its server: calls from the
// browser go through this host, and calls made while this host renders go directly.
const remoteServerFunctions = createRemoteServerFunctions({
  remotes: { tanstack_rsbuild_ssr_remote: { origin: "http://127.0.0.1:3004" } },
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
