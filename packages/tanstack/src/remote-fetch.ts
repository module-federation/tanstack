export type RemoteFetchOptions = {
  /** Maximum time for the request and response body to complete. Defaults to 10 seconds. */
  fetchTimeoutMs?: number;
  /** Maximum response body size in bytes. Defaults to 10 MiB. Set to 0 to disable. */
  fetchMaxBytes?: number;
};

export const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_REMOTE_FETCH_MAX_BYTES = 10 * 1024 * 1024;

/** Fetches a remote response as text with a bounded timeout and response body. */
export async function fetchRemoteText(
  url: string,
  options: RemoteFetchOptions = {},
): Promise<string> {
  const timeoutMs = options.fetchTimeoutMs ?? DEFAULT_REMOTE_FETCH_TIMEOUT_MS;
  const maxBytes = options.fetchMaxBytes ?? DEFAULT_REMOTE_FETCH_MAX_BYTES;
  const controller = timeoutMs === 0 ? undefined : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}.`);

    const contentLength = response.headers.get("content-length");
    if (maxBytes > 0 && contentLength && Number(contentLength) > maxBytes) {
      await response.body?.cancel();
      throw new Error(
        `${url} response exceeds the maximum size of ${maxBytes} bytes ` +
          `(content-length: ${contentLength}).`,
      );
    }

    if (!response.body) {
      const text = await response.text();
      assertResponseSize(url, new TextEncoder().encode(text).byteLength, maxBytes);
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        assertResponseSize(url, bytes, maxBytes);
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Fetches and parses a remote JSON response using the shared fetch policy. */
export async function fetchRemoteJson<T>(
  url: string,
  options: RemoteFetchOptions = {},
): Promise<T> {
  const text = await fetchRemoteText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error(`Could not parse the JSON response from ${url}.`, { cause });
  }
}

function assertResponseSize(url: string, bytes: number, maxBytes: number) {
  if (maxBytes > 0 && bytes > maxBytes) {
    throw new Error(
      `${url} response exceeds the maximum size of ${maxBytes} bytes (received: ${bytes}).`,
    );
  }
}
