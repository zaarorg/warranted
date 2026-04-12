"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";

interface AgentIdentity {
  agentId: string;
  did: string;
  name: string | null;
  status: string;
  createdAt: string;
}

export default function AgentsPage() {
  const [did, setDid] = useState("");
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    apiFetch<AgentIdentity[]>("/api/agents")
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  function handleLookup() {
    if (did.trim()) {
      router.push(`/agents/${encodeURIComponent(did.trim())}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <Link href="/agents/new">
          <Button>Create Agent</Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : agents.length > 0 ? (
        <div className="space-y-2">
          {agents.map((agent) => (
            <Card key={agent.agentId}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">{agent.name ?? agent.agentId}</p>
                  <p className="text-xs font-mono text-muted-foreground">{agent.did}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={agent.status === "active" ? "default" : "destructive"}>
                    {agent.status}
                  </Badge>
                  <Link href={`/agents/${encodeURIComponent(agent.did)}`}>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Look up agent by DID</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="did:mesh:..."
            value={did}
            onChange={(e) => setDid(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
          <Button onClick={handleLookup} disabled={!did.trim()}>
            View Envelope
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
