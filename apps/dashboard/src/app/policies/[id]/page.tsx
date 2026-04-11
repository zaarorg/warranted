"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CedarSourceViewer } from "@/components/cedar/CedarSourceViewer";
import { apiFetch } from "@/lib/api";
import type { Policy, PolicyVersion, DimensionConstraint } from "@/lib/types";

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<PolicyVersion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

        <TabsContent value="constraints" className="mt-4">
          {activeVersion ? (
            <ConstraintsView constraints={activeVersion.constraints} />
          ) : (
            <p className="text-sm text-muted-foreground">No active version.</p>
          )}
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
