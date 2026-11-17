import { createServerFn } from "@tanstack/react-start";

// Runs on this remote's server only. Hosts that render the remote call it over HTTP: from
// the browser through the host, and from the host's server while it renders.
export const getRemoteGreeting = createServerFn({ method: "GET" }).handler(async () => ({
  message: "Answered by the Rsbuild remote's server",
}));

// A POST function with input, so the call's body crosses the host on its way to the remote.
export const greetHost = createServerFn({ method: "POST" })
  .validator((data: { host: string }) => {
    if (typeof data?.host !== "string" || data.host.length === 0) {
      throw new Error("greetHost needs a host name");
    }
    return { host: data.host };
  })
  .handler(async ({ data }) => ({
    message: `The Rsbuild remote's server greets ${data.host}`,
  }));

// Reports who the host says is asking, and whether any cookie reached this server. Hosts
// forward no credentials by default; the example hosts send the signed-in visitor's name in
// an `x-example-visitor` header from `createRemoteServerFunctions({ headers })`, and keep
// their cookies, which belong to their own origin.
export const whoIsAsking = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const visitor = getRequestHeader("x-example-visitor");
  return {
    cookies: getRequestHeader("cookie") ? "forwarded" : "none",
    message: visitor
      ? `The Rsbuild remote's server sees ${visitor}`
      : "The Rsbuild remote's server sees an anonymous visitor",
  };
});
