"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PetitionComingSoon() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Petitioning</h1>
      <p className="text-muted-foreground">Coming Soon</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            When an agent is denied an action (e.g., a purchase exceeding its spending limit),
            it will be able to file a petition requesting a one-time exception.
          </p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <strong>Agent files petition</strong> — specifies the denied action, dimension,
              requested value, and a justification.
            </li>
            <li>
              <strong>System routes to approver</strong> — walks up the group hierarchy to find
              the lowest level whose envelope permits the requested value.
            </li>
            <li>
              <strong>Approver reviews and decides</strong> — approves (grants a time-limited
              exception) or denies with a reason.
            </li>
            <li>
              <strong>Audit trail</strong> — petition records are immutable. All decisions are logged.
            </li>
          </ol>
          <p className="text-xs mt-4">
            See <code>docs/plans/rules-engine-SPEC.md</code> for the full petitioning specification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
