"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { SeedModal } from "@/components/SeedModal";

interface Group {
  id: string;
  name: string;
  nodeType: string;
}

interface Policy {
  id: string;
  name: string;
  effect: string;
}

interface CreateResult {
  agentId: string;
  did: string;
  seed: string;
  publicKey: string;
  lineage: string[];
}

export default function NewAgentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [sponsorMembershipId, setSponsorMembershipId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  useEffect(() => {
    apiFetch<Group[]>("/api/policies/groups").then(setGroups).catch(() => {});
    apiFetch<Policy[]>("/api/policies/rules").then(setPolicies).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const data = await apiFetch<CreateResult>("/api/agents/create", {
        method: "POST",
        body: JSON.stringify({
          name,
          groupId,
          policyIds: selectedPolicies,
          sponsorMembershipId,
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  function togglePolicy(id: string) {
    setSelectedPolicies((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  if (result) {
    return (
      <SeedModal
        agentId={result.agentId}
        did={result.did}
        seed={result.seed}
        onClose={() => router.push(`/agents/${encodeURIComponent(result.did)}`)}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-2xl font-semibold">Create Agent</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent Identity</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Agent Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="procurement-agent-01"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Sponsor Membership ID</label>
              <Input
                value={sponsorMembershipId}
                onChange={(e) => setSponsorMembershipId(e.target.value)}
                placeholder="om_..."
                required
              />
              <p className="text-xs text-muted-foreground">
                Your WorkOS organization membership ID
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Group</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                required
              >
                <option value="">Select a group...</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.nodeType})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Policies</label>
              <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                {policies
                  .filter((p) => p.effect === "allow")
                  .map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedPolicies.includes(p.id)}
                        onChange={() => togglePolicy(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              disabled={submitting || !name || !groupId || selectedPolicies.length === 0}
            >
              {submitting ? "Creating..." : "Create Agent"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
