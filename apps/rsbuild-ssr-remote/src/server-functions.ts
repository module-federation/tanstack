import { createServerFn } from "@tanstack/react-start";

// Runs on this remote's server only. Hosts that render the remote call it over HTTP: from
// the browser through the host, and from the host's server while it renders.
export const getRemoteGreeting = createServerFn({ method: "GET" }).handler(async () => ({
  message: "Answered by the Rsbuild remote's server",
}));
