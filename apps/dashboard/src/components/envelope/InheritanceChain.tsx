"use client";

import { useState } from "react";
import type { DimensionSource } from "@/lib/types";

const levelOrder = ["org", "department", "team", "unassigned", "agent"] as const;

export function InheritanceChain({ sources }: { sources: DimensionSource[] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  const sorted = [...sources].sort(
    (a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level),
  );

  return (
    <div className="ml-42">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline cursor-pointer"
      >
        {open ? "Hide" : "Show"} provenance ({sources.length} source{sources.length !== 1 ? "s" : ""})
      </button>
      {open && (
        <div className="mt-1 ml-2 border-l-2 border-muted pl-3 space-y-1">
          {sorted.map((src, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{src.policyName}</span>
              {src.groupName && (
                <span className="text-muted-foreground"> via {src.groupName}</span>
              )}
              <span className="ml-1 text-muted-foreground">({src.level})</span>
              <span className="ml-1 font-mono">{formatValue(src.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return `<= ${value}`;
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
