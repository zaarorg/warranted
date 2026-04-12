import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

// Next.js 16 uses proxy.ts, but middleware.ts still works for ≤15 compat.
// If using Next.js 16+, this may need to be migrated to proxy.ts
// depending on the authkit-nextjs version.
export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/login"],
  },
});

export const config = {
  matcher: [
    // Protect all routes except static assets
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
