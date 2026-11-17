import { createServerFn } from "@tanstack/react-start";

// A demo sign-in owned by the host. The cookie belongs to the host's origin and never
// leaves it: start.ts sends the remote only the visitor's name, in one header.
export const VISITORS = ["Ada", "Grace"] as const;
export type Visitor = (typeof VISITORS)[number];

const VISITOR_COOKIE = "example_visitor";

function asVisitor(value: unknown): Visitor | null {
  return VISITORS.find((visitor) => visitor === value) ?? null;
}

/** The visitor signed in on `request`, read from its cookies. */
export function visitorFromRequest(request: Request | undefined): Visitor | null {
  const cookies = request?.headers.get("cookie") ?? "";
  for (const cookie of cookies.split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === VISITOR_COOKIE) return asVisitor(decodeURIComponent(value.join("=")));
  }
  return null;
}

export const getVisitor = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  return visitorFromRequest(getRequest());
});

export const setVisitor = createServerFn({ method: "POST" })
  .validator((data: { visitor: string | null }) => {
    if (data.visitor !== null && !asVisitor(data.visitor)) throw new Error("Unknown visitor");
    return { visitor: asVisitor(data.visitor) };
  })
  .handler(async ({ data }) => {
    const { deleteCookie, setCookie } = await import("@tanstack/react-start/server");
    if (data.visitor) {
      setCookie(VISITOR_COOKIE, data.visitor, { httpOnly: true, path: "/", sameSite: "lax" });
    } else {
      deleteCookie(VISITOR_COOKIE, { path: "/" });
    }
    return data.visitor;
  });
