"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CedarSourceViewer } from "@/components/cedar/CedarSourceViewer";
import { DimensionInputField } from "@/components/repl/DimensionInputField";
import { apiFetch } from "@/lib/api";
import type {
  ActionType,
  DimensionConstraint,
  DimensionDefinition,
  Policy,
  PolicyConstraint,
  PolicyVersion,
} from "@/lib/types";

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<PolicyVersion | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [p, vs] = await Promise.all([
        apiFetch<Policy>(`/api/policies/rules/${params.id}`),
        apiFetch<PolicyVersion[]>(`/api/policies/rules/${params.id}/versions`),
      ]);
      setPolicy(p);
      setVersions(vs.sort((a, b) => b.versionNumber - a.versionNumber));
      const active = vs.find((v) => v.id === p.activeVersionId) ?? null;
      setActiveVersion(active);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [params.id]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!policy) return <p className="text-sm text-destructive">Policy not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{policy.name}</h1>
        <Badge variant={policy.effect === "allow" ? "default" : "destructive"}>
          {policy.effect}
        </Badge>
        <Badge variant="outline">{policy.domain}</Badge>
      </div>

      <Tabs defaultValue="constraints">
        <TabsList>
          <TabsTrigger value="constraints">Constraints</TabsTrigger>
          <TabsTrigger value="cedar">Cedar</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="constraints" className="mt-4 space-y-6">
          {activeVersion ? (
            <ConstraintsView constraints={activeVersion.constraints} />
          ) : (
            <p className="text-sm text-muted-foreground">No active version.</p>
          )}
          <CreateVersionForm policyId={params.id} onCreated={load} />
        </TabsContent>

        <TabsContent value="cedar" className="mt-4">
          {activeVersion ? (
            <CedarSourceViewer source={activeVersion.cedarSource} />
          ) : (
            <p className="text-sm text-muted-foreground">No active version.</p>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <VersionHistory versions={versions} activeId={policy.activeVersionId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create Version Form                                                 */
/* ------------------------------------------------------------------ */

function CreateVersionForm({
  policyId,
  onCreated,
}: {
  policyId: string;
  onCreated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [selectedActionId, setSelectedActionId] = useState("");
  const [dimValues, setDimValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCedar, setPreviewCedar] = useState<string | null>(null);

  useEffect(() => {
    if (expanded && actionTypes.length === 0) {
      apiFetch<ActionType[]>("/api/policies/action-types")
        .then(setActionTypes)
        .catch((err) => setError(err.message));
    }
  }, [expanded]);

  const selectedAction = actionTypes.find((at) => at.id === selectedActionId);

  function handleDimensionChange(name: string, value: unknown) {
    setDimValues((prev) => ({ ...prev, [name]: value }));
  }

  function buildConstraints(): PolicyConstraint[] | null {
    if (!selectedAction) return null;

    const dimensions: DimensionConstraint[] = [];

    for (const dim of selectedAction.dimensions) {
      const val = dimValues[dim.dimensionName];
      if (val === undefined || val === "") continue;

      switch (dim.kind) {
        case "numeric":
          if (typeof val !== "number") continue;
          dimensions.push({ name: dim.dimensionName, kind: "numeric", max: val });
          break;
        case "set":
          if (typeof val !== "string" || !val.trim()) continue;
          dimensions.push({
            name: dim.dimensionName,
            kind: "set",
            members: val.split(",").map((s) => s.trim()).filter(Boolean),
          });
          break;
        case "boolean":
          dimensions.push({
            name: dim.dimensionName,
            kind: "boolean",
            value: val === true,
            restrictive: dim.boolRestrictive ?? false,
          });
          break;
        case "temporal":
          if (typeof val !== "string" || !val.trim()) continue;
          dimensions.push({ name: dim.dimensionName, kind: "temporal", expiry: val });
          break;
        case "rate":
          if (typeof val !== "number") continue;
          dimensions.push({
            name: dim.dimensionName,
            kind: "rate",
            limit: val,
            window: dim.rateWindow ?? "1 hour",
          });
          break;
      }
    }

    if (dimensions.length === 0) return null;

    return [
      {
        actionTypeId: selectedAction.id,
        actionName: selectedAction.name,
        dimensions,
      },
    ];
  }

  async function handleSave() {
    const constraints = buildConstraints();
    if (!constraints) {
      setError("Select an action type and fill in at least one dimension.");
      return;
    }

    setSaving(true);
    setError(null);
    setPreviewCedar(null);

    try {
      const result = await apiFetch<{
        id: string;
        versionNumber: number;
        cedarSource: string;
        cedarHash: string;
      }>(`/api/policies/rules/${policyId}/versions`, {
        method: "POST",
        body: JSON.stringify({ constraints }),
      });
      setPreviewCedar(result.cedarSource);
      setExpanded(false);
      setSelectedActionId("");
      setDimValues({});
      setPreviewCedar(null);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create version");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    const constraints = buildConstraints();
    if (!constraints) {
      setError("Select an action type and fill in at least one dimension.");
      return;
    }
    setError(null);

    // Create the version to get generated Cedar, then show it
    // For preview we just show the constraints summary since Cedar is generated server-side
    const lines: string[] = [];
    for (const c of constraints) {
      lines.push(`// Action: ${c.actionName}`);
      for (const d of c.dimensions) {
        switch (d.kind) {
          case "numeric":
            lines.push(`//   ${d.name}: max ${d.max}`);
            break;
          case "set":
            lines.push(`//   ${d.name}: [${d.members.join(", ")}]`);
            break;
          case "boolean":
            lines.push(`//   ${d.name}: ${d.value} (restrictive: ${d.restrictive})`);
            break;
          case "temporal":
            lines.push(`//   ${d.name}: expires ${d.expiry}`);
            break;
          case "rate":
            lines.push(`//   ${d.name}: ${d.limit} per ${d.window}`);
            break;
        }
      }
    }
    setPreviewCedar(lines.join("\n"));
  }

  if (!expanded) {
    return (
      <Button variant="outline" onClick={() => setExpanded(true)}>
        Create New Version
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Create New Version</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Action Type</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={selectedActionId}
            onChange={(e) => {
              setSelectedActionId(e.target.value);
              setDimValues({});
              setPreviewCedar(null);
              setError(null);
            }}
          >
            <option value="">Select an action type...</option>
            {actionTypes.map((at) => (
              <option key={at.id} value={at.id}>
                {at.name} ({at.domain})
              </option>
            ))}
          </select>
        </div>

        {selectedAction && selectedAction.dimensions.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set the constraint values for each dimension. Only filled dimensions will be
              included. For &quot;set&quot; dimensions, enter comma-separated values.
            </p>
            {selectedAction.dimensions.map((dim) => (
              <DimensionInputField
                key={dim.id}
                dimension={dim}
                value={dimValues[dim.dimensionName]}
                onChange={handleDimensionChange}
              />
            ))}
          </div>
        )}

        {previewCedar && (
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs font-medium mb-1">Constraint Preview</p>
            <pre className="text-xs font-mono whitespace-pre-wrap">{previewCedar}</pre>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePreview} disabled={saving}>
            Preview
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Version"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setExpanded(false);
              setError(null);
              setPreviewCedar(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Existing sub-components (unchanged)                                 */
/* ------------------------------------------------------------------ */

function ConstraintsView({ constraints }: { constraints: PolicyVersion["constraints"] }) {
  if (!constraints || constraints.length === 0) {
    return <p className="text-sm text-muted-foreground">No constraints defined.</p>;
  }

  return (
    <div className="space-y-4">
      {constraints.map((c, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono">{c.actionName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.dimensions.map((dim) => (
              <DimensionConstraintRow key={dim.name} dim={dim} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DimensionConstraintRow({ dim }: { dim: DimensionConstraint }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium w-40">{dim.name}</span>
      <Badge variant="outline" className="text-xs">{dim.kind}</Badge>
      <span className="font-mono text-muted-foreground">{formatConstraint(dim)}</span>
    </div>
  );
}

function formatConstraint(dim: DimensionConstraint): string {
  switch (dim.kind) {
    case "numeric": return `max: ${dim.max.toLocaleString()}`;
    case "set": return dim.members.join(", ");
    case "boolean": return `${dim.value} (restrictive: ${dim.restrictive})`;
    case "temporal": return `expires: ${dim.expiry}`;
    case "rate": return `${dim.limit} per ${dim.window}`;
  }
}

function VersionHistory({
  versions,
  activeId,
}: {
  versions: PolicyVersion[];
  activeId: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {versions.map((v) => (
        <Card key={v.id}>
          <CardHeader
            className="pb-2 cursor-pointer"
            onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
          >
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">v{v.versionNumber}</CardTitle>
              {v.id === activeId && (
                <Badge variant="default" className="text-xs">active</Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(v.createdAt).toLocaleString()}
              </span>
              {v.createdBy && (
                <span className="text-xs text-muted-foreground">by {v.createdBy}</span>
              )}
              <span className="text-xs font-mono text-muted-foreground">
                {v.cedarHash.slice(0, 12)}...
              </span>
            </div>
          </CardHeader>
          {expandedId === v.id && (
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs font-medium mb-1">Constraints</p>
                <ConstraintsView constraints={v.constraints} />
              </div>
              <div>
                <p className="text-xs font-medium mb-1">Cedar Source</p>
                <CedarSourceViewer source={v.cedarSource} />
              </div>
            </CardContent>
          )}
        </Card>
      ))}
      {versions.length === 0 && (
        <p className="text-sm text-muted-foreground">No versions yet.</p>
      )}
    </div>
  );
}
