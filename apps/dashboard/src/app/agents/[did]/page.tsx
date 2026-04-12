"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnvelopeView } from "@/components/envelope/EnvelopeView";
import { PolicyREPL } from "@/components/repl/PolicyREPL";
import { apiFetch } from "@/lib/api";
import type { ResolvedEnvelope } from "@/lib/types";

export default function AgentDetailPage() {
  const params = useParams<{ did: string }>();
  const agentDid = decodeURIComponent(params.did);
  const [envelope, setEnvelope] = useState<ResolvedEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ResolvedEnvelope>(`/api/policies/agents/${encodeURIComponent(agentDid)}/envelope`)
      .then(setEnvelope)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [agentDid]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Agent</h1>
        <p className="text-sm font-mono text-muted-foreground break-all">{agentDid}</p>
      </div>

      <Tabs defaultValue="envelope">
        <TabsList>
          <TabsTrigger value="envelope">Envelope</TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
        </TabsList>

        <TabsContent value="envelope" className="mt-4">
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {envelope && <EnvelopeView envelope={envelope} />}
        </TabsContent>

        <TabsContent value="test" className="mt-4">
          <PolicyREPL agentDid={agentDid} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
