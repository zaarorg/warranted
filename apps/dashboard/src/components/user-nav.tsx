"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import Link from "next/link";

export function UserNav() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-1 mt-auto pt-4 border-t border-border">
      <div className="px-3 py-2">
        <p className="text-sm font-medium truncate">{user.firstName ?? user.email}</p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      </div>
      <form action="/auth/signout" method="POST">
        <button
          type="submit"
          className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
