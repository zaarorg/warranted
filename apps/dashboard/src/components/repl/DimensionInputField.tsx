"use client";

import { Input } from "@/components/ui/input";
import type { DimensionDefinition } from "@/lib/types";

interface Props {
  dimension: DimensionDefinition;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}

export function DimensionInputField({ dimension, value, onChange }: Props) {
  const name = dimension.dimensionName;

  switch (dimension.kind) {
    case "numeric":
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{name}</label>
          <Input
            type="number"
            placeholder={dimension.numericMax ? `max: ${dimension.numericMax}` : ""}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(name, e.target.value ? Number(e.target.value) : "")}
          />
        </div>
      );

    case "set":
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{name}</label>
          <Input
            type="text"
            placeholder={dimension.setMembers?.join(", ") ?? "comma-separated values"}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(name, e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Enter a single value to test</p>
        </div>
      );

    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`dim-${name}`}
            checked={value === true}
            onChange={(e) => onChange(name, e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor={`dim-${name}`} className="text-sm font-medium">
            {name}
          </label>
        </div>
      );

    case "temporal":
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{name}</label>
          <Input
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(name, e.target.value)}
          />
        </div>
      );

    case "rate":
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">
            {name} (current count{dimension.rateWindow ? ` per ${dimension.rateWindow}` : ""})
          </label>
          <Input
            type="number"
            placeholder={dimension.rateLimit ? `limit: ${dimension.rateLimit}` : ""}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(name, e.target.value ? Number(e.target.value) : "")}
          />
        </div>
      );

    default:
      return null;
  }
}
