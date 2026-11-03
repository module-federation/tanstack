import { createServerFn } from "@tanstack/react-start";

// Exposed so that the build tests can check that a remote's server function handlers stay
// on its own server: the published Node container must only contain an RPC caller.
export const getRemoteServerStatus = createServerFn({ method: "GET" }).handler(async () => ({
  status: "rsbuild-ssr-remote server function handler",
}));
