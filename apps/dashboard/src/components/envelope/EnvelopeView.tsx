"use client";

import type { ResolvedEnvelope } from "@/lib/types";
import { DenyBanner } from "./DenyBanner";
import { DimensionDisplay } from "./DimensionDisplay";
import { InheritanceChain } from "./InheritanceChain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function EnvelopeView({ envelope }: { envelope: ResolvedEnvelope }) {
  if (envelope.actions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No actions resolved for this agent.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Policy version {envelope.policyVersion} &middot; Resolved{" "}
        {new Date(envelope.resolvedAt).toLocaleString()}
      </p>
      {envelope.actions.map((action) => (
        <Card key={action.actionId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-mono">
              {action.actionName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {action.denied && action.denySource && (
              <DenyBanner denySource={action.denySource} />
            )}
            {action.dimensions.length === 0 && !action.denied && (
              <p className="text-sm text-muted-foreground">No dimension constraints.</p>
            )}
            {action.dimensions.map((dim) => (
              <div key={dim.name}>
                <DimensionDisplay dimension={dim} />
                <InheritanceChain sources={dim.sources} />
                <Separator className="mt-2" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
