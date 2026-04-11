"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AgentsPage() {
  const [did, setDid] = useState("");
  const router = useRouter();

  function handleLookup() {
    if (did.trim()) {
      router.push(`/agents/${encodeURIComponent(did.trim())}`);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Agents</h1>
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
