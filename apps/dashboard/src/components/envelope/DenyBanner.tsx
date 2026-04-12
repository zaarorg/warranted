"use client";

export function DenyBanner({ denySource }: { denySource: string }) {
  return (
    <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-medium">
      Denied by policy: {denySource}
    </div>
  );
}
