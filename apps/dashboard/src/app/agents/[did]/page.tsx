"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnvelopeView } from "@/components/envelope/EnvelopeView";
import { PolicyREPL } from "@/components/repl/PolicyREPL";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { ResolvedEnvelope } from "@/lib/types";

interface AgentDetail {
  identity: {
    agentId: string;
    did: string;
    name: string | null;
    status: string;
    createdAt: string;
  };
  lineage: {
    parentId: string;
    parentType: string;
    sponsorUserId: string;
    lineage: string[];
  } | null;
  envelope: ResolvedEnvelope | null;
  memberships: { agentDid: string; groupId: string }[];
}

export default function AgentDetailPage() {
  const params = useParams<{ did: string }>();
  const agentDid = decodeURIComponent(params.did);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [envelope, setEnvelope] = useState<ResolvedEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  function loadData() {
    setLoading(true);
    // Try Phase 2 agent detail endpoint first, fallback to envelope-only
    apiFetch<AgentDetail>(`/api/agents/${encodeURIComponent(agentDid)}`)
      .then((data) => {
        setDetail(data);
        setEnvelope(data.envelope);
      })
      .catch(() => {
        // Fallback: agent not in identity table, load envelope only
        apiFetch<ResolvedEnvelope>(
          `/api/policies/agents/${encodeURIComponent(agentDid)}/envelope`,
        )
          .then(setEnvelope)
          .catch((err) => setError(err.message));
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadData, [agentDid]);

  async function updateStatus(newStatus: string) {
    setStatusUpdating(true);
    try {
      await apiFetch(`/api/agents/${encodeURIComponent(agentDid)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function downloadSeed() {
    try {
      const data = await apiFetch<{ seed: string }>(
        `/api/agents/${encodeURIComponent(agentDid)}/seed`,
      );
      await navigator.clipboard.writeText(data.seed);
      alert("Seed copied to clipboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed download failed");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Agent</h1>
        <p className="text-sm font-mono text-muted-foreground break-all">{agentDid}</p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {detail.identity.name ?? detail.identity.agentId}
              <Badge
                variant={detail.identity.status === "active" ? "default" : "destructive"}
              >
                {detail.identity.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Agent ID</span>
              <span className="font-mono text-xs">{detail.identity.agentId}</span>
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(detail.identity.createdAt).toLocaleDateString()}</span>
            </div>

            {detail.lineage && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Lineage</p>
                <div className="flex items-center gap-1 text-xs font-mono">
                  {(detail.lineage.lineage as string[]).map((id, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-muted-foreground mx-1">&rarr;</span>}
                      <span className="bg-muted px-1 rounded">{id.slice(0, 16)}...</span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Depth: {(detail.lineage.lineage as string[]).length} | Sponsor: {detail.lineage.parentType}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {detail.identity.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateStatus("suspended")}
                  disabled={statusUpdating}
                >
                  Suspend
                </Button>
              )}
              {detail.identity.status === "suspended" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateStatus("active")}
                    disabled={statusUpdating}
                  >
                    Reactivate
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => updateStatus("revoked")}
                    disabled={statusUpdating}
                  >
                    Revoke
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={downloadSeed}>
                Re-download Seed
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="envelope">
        <TabsList>
          <TabsTrigger value="envelope">Envelope</TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
        </TabsList>

        <TabsContent value="envelope" className="mt-4">
          {envelope && <EnvelopeView envelope={envelope} />}
          {!loading && !envelope && (
            <p className="text-sm text-muted-foreground">No envelope data available</p>
          )}
        </TabsContent>

        <TabsContent value="test" className="mt-4">
          <PolicyREPL agentDid={agentDid} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
