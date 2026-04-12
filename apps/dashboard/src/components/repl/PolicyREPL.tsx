"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DimensionInputField } from "./DimensionInputField";
import { apiFetch } from "@/lib/api";
import type { ActionType, CheckResponse } from "@/lib/types";

interface Props {
  agentDid: string;
}

export function PolicyREPL({ agentDid }: Props) {
  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [contextValues, setContextValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ActionType[]>("/api/policies/action-types")
      .then(setActionTypes)
      .catch((err) => setError(err.message));
  }, []);

  const selected = actionTypes.find((at) => at.name === selectedAction);

  function handleDimensionChange(name: string, value: unknown) {
    setContextValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleTest() {
    if (!selectedAction) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const context: Record<string, unknown> = {};
    if (selected) {
      for (const dim of selected.dimensions) {
        const val = contextValues[dim.dimensionName];
        if (val !== undefined && val !== "") {
          context[dim.dimensionName] = val;
        }
      }
    }

    try {
      const res = await apiFetch<CheckResponse>("/api/policies/check", {
        method: "POST",
        body: JSON.stringify({
          principal: `Agent::"${agentDid}"`,
          action: `Action::"${selectedAction}"`,
          resource: `Resource::"test"`,
          context,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium">Action Type</label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          value={selectedAction}
          onChange={(e) => {
            setSelectedAction(e.target.value);
            setContextValues({});
            setResult(null);
          }}
        >
          <option value="">Select an action type...</option>
          {actionTypes.map((at) => (
            <option key={at.id} value={at.name}>
              {at.name} ({at.domain})
            </option>
          ))}
        </select>
      </div>

      {selected && selected.dimensions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Context Values</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected.dimensions.map((dim) => (
              <DimensionInputField
                key={dim.id}
                dimension={dim}
                value={contextValues[dim.dimensionName]}
                onChange={handleDimensionChange}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Button onClick={handleTest} disabled={!selectedAction || loading}>
        {loading ? "Testing..." : "Test Authorization"}
      </Button>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {result && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Badge
                className="text-lg px-4 py-1"
                variant={result.decision === "Allow" ? "default" : "destructive"}
              >
                {result.decision}
              </Badge>
            </div>
            {result.diagnostics.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1">Diagnostics</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {result.diagnostics.map((d, i) => (
                    <li key={i} className="font-mono text-xs">{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.engineCode && (
              <p className="text-xs text-muted-foreground">
                Engine: <span className="font-mono">{result.engineCode}</span>
                {result.sdkCode && (
                  <> &middot; SDK: <span className="font-mono">{result.sdkCode}</span></>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
