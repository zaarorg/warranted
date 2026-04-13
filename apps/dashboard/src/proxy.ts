import { NextRequest } from "next/server";
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";

export default async function proxy(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request);

  const { pathname } = request.nextUrl;

  // Don't redirect API routes — the catch-all route handler returns 401 JSON
  if (
    !pathname.startsWith("/api/") &&
    pathname !== "/login" &&
    !session.user &&
    authorizationUrl
  ) {
    return handleAuthkitHeaders(request, headers, {
      redirect: authorizationUrl,
    });
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = {
  matcher: [
    // All routes except static assets
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
