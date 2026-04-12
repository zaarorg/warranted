"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SeedModalProps {
  agentId: string;
  did: string;
  seed: string;
  onClose: () => void;
}

export function SeedModal({ agentId, did, seed, onClose }: SeedModalProps) {
  const [showSeed, setShowSeed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const dockerCommand = `docker run -e ED25519_PRIVATE_KEY=${seed} -e RULES_ENGINE_URL=http://api:3000/api/policies/check warranted/governance-sidecar:0.1.0`;

  const envFile = `ED25519_PRIVATE_KEY=${seed}\nRULES_ENGINE_URL=http://api:3000/api/policies/check`;

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadEnvFile() {
    const blob = new Blob([envFile], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sidecar-${agentId}.env`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Agent Created Successfully</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Agent ID</label>
            <p className="text-sm font-mono bg-muted p-2 rounded">{agentId}</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">DID</label>
            <p className="text-sm font-mono bg-muted p-2 rounded break-all">{did}</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">ED25519_SEED</label>
            <div className="flex gap-2">
              <Input
                type={showSeed ? "text" : "password"}
                value={seed}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSeed(!showSeed)}
              >
                {showSeed ? "Hide" : "Show"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(seed)}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Docker command</label>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
              {dockerCommand}
            </pre>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(dockerCommand)}
            >
              Copy command
            </Button>
          </div>

          <Button variant="outline" onClick={downloadEnvFile}>
            Download sidecar.env
          </Button>

          <div className="border-t pt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have saved this seed. I understand it cannot be displayed again in this session.
            </label>
            <Button onClick={onClose} disabled={!confirmed} className="w-full">
              Done
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
