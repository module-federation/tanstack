// TanStack Start compiles a server function into an RPC caller in every environment that
// does not provide it. In a remote's Node container, the caller replaces the handler, so
// the handler never ships in the public container. The host that runs the container does
// not know the remote's functions, so a call during server rendering cannot be resolved
// yet; it fails here with an explanation instead of in Start's resolver.

// Start marks server functions with this registered symbol.
const TSS_SERVER_FUNCTION = Symbol.for("TSS_SERVER_FUNCTION");

/** Replaces `@tanstack/react-start/ssr-rpc` in a remote's Node container. */
export function createSsrRpc(functionId: string) {
  const fn = async (..._args: unknown[]): Promise<never> => {
    throw new Error(
      `Server function "${functionId}" belongs to a federated remote and was called while ` +
        "a host rendered the remote on the server. A remote's server functions run on the " +
        "remote's own server, and hosts cannot call them during server rendering.",
    );
  };
  return Object.assign(fn, {
    url: process.env.TSS_SERVER_FN_BASE + functionId,
    serverFnMeta: { id: functionId },
    [TSS_SERVER_FUNCTION]: true,
  });
}
