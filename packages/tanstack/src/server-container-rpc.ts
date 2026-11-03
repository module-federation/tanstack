// TanStack Start compiles a server function into an RPC caller in every environment that
// does not provide it. In a remote's Node container, the caller replaces the handler, so
// the handler never ships in the public container. While a host renders the remote on the
// server, the caller sends the call to the remote's server over HTTP, with Start's own
// serialization, at the origin the host configured for the remote.
import { createClientRpc } from "@tanstack/react-start/client-rpc";
import { fetchRemoteServerFunction } from "./server-functions";

// The adapter defines the remote's federation name in its Node container.
declare const __MF_TANSTACK_REMOTE_NAME__: string | undefined;

// Start marks server functions with this registered symbol.
const TSS_SERVER_FUNCTION = Symbol.for("TSS_SERVER_FUNCTION");

type RpcOptions = { fetch?: typeof fetch } & Record<string, unknown>;

export type RemoteSsrRpc = ((options?: RpcOptions) => Promise<unknown>) & {
  url: string;
  serverFnMeta: { id: string };
  [TSS_SERVER_FUNCTION]: true;
};

/** Replaces `@tanstack/react-start/ssr-rpc` in a remote's Node container. */
export function createSsrRpc(functionId: string): RemoteSsrRpc {
  const rpc = createClientRpc(functionId);
  const remote =
    typeof __MF_TANSTACK_REMOTE_NAME__ === "string" ? __MF_TANSTACK_REMOTE_NAME__ : undefined;

  const fn = (options: RpcOptions = {}) => {
    if (!remote) {
      return Promise.reject(
        new Error(`Server function "${functionId}" was compiled without its remote's name.`),
      );
    }
    const fetchImpl = options.fetch ?? fetch;
    return rpc({
      ...options,
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetchRemoteServerFunction(remote, String(input), init ?? {}, fetchImpl),
    });
  };

  return Object.assign(fn, {
    url: rpc.url,
    serverFnMeta: rpc.serverFnMeta,
    [TSS_SERVER_FUNCTION]: true as const,
  });
}
