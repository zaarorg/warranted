"use client";

import { Badge } from "@/components/ui/badge";
import type { ResolvedDimension } from "@/lib/types";

export function DimensionDisplay({ dimension }: { dimension: ResolvedDimension }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-sm font-medium text-muted-foreground w-40 shrink-0">
        {dimension.name}
      </span>
      <div className="flex flex-wrap gap-1 items-center">
        <Badge variant="outline" className="text-xs">
          {dimension.kind}
        </Badge>
        {renderValue(dimension)}
      </div>
    </div>
  );
}

function renderValue(dim: ResolvedDimension) {
  const val = dim.resolved;

  switch (dim.kind) {
    case "numeric":
      return (
        <span className="text-sm font-mono">
          &le; {typeof val === "number" ? val.toLocaleString() : String(val)}
        </span>
      );

    case "set": {
      const members = Array.isArray(val) ? val : [];
      return (
        <div className="flex flex-wrap gap-1">
          {members.map((m: string) => (
            <Badge key={m} variant="secondary" className="text-xs font-mono">
              {m}
            </Badge>
          ))}
        </div>
      );
    }

    case "boolean":
      return (
        <Badge variant={val ? "default" : "secondary"} className="text-xs">
          {val ? "Yes" : "No"}
        </Badge>
      );

    case "temporal":
      return (
        <span className="text-sm font-mono">
          Expires: {String(val)}
        </span>
      );

    case "rate": {
      const rate = val as { limit: number; window: string } | null;
      if (rate && typeof rate === "object" && "limit" in rate) {
        return (
          <span className="text-sm font-mono">
            {rate.limit} per {rate.window}
          </span>
        );
      }
      return <span className="text-sm font-mono">{String(val)}</span>;
    }

    default:
      return <span className="text-sm">{String(val)}</span>;
  }
}
