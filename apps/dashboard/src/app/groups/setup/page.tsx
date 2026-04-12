"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { Group } from "@/lib/types";

type NodeType = "org" | "department" | "team";

interface GroupSetupRow {
  group: Group;
  selectedNodeType: NodeType | null;
  selectedParentId: string | null;
  saving: boolean;
  saved: boolean;
}

export default function GroupSetupPage() {
  const [rows, setRows] = useState<GroupSetupRow[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  function loadData() {
    setLoading(true);
    apiFetch<Group[]>("/api/policies/groups")
      .then((groups) => {
        setAllGroups(groups);
        const unassigned = groups.filter((g) => g.nodeType === "unassigned");
        setRows(
          unassigned.map((g) => ({
            group: g,
            selectedNodeType: null,
            selectedParentId: null,
            saving: false,
            saved: false,
          })),
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  function updateRow(id: string, updates: Partial<GroupSetupRow>) {
    setRows((prev) =>
      prev.map((r) => (r.group.id === id ? { ...r, ...updates } : r)),
    );
  }

  async function saveGroup(row: GroupSetupRow) {
    if (!row.selectedNodeType) return;
    updateRow(row.group.id, { saving: true });
    try {
      await apiFetch(`/api/policies/groups/${row.group.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nodeType: row.selectedNodeType,
          parentId: row.selectedParentId,
        }),
      });
      updateRow(row.group.id, { saving: false, saved: true });
    } catch (err) {
      console.error(err);
      updateRow(row.group.id, { saving: false });
    }
  }

  const assignableParents = allGroups.filter(
    (g) => g.nodeType !== "unassigned",
  );

  const pendingCount = rows.filter((r) => !r.saved).length;

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Group Setup</h1>
          {pendingCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {pendingCount} unassigned
            </Badge>
          )}
        </div>
        <Link href="/groups">
          <Button variant="outline" size="sm">
            Back to Groups
          </Button>
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Groups synced from your identity provider need a type assignment before
        they can be used in policy evaluation.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            All groups have been assigned. No setup needed.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {rows.map((row) => (
            <div
              key={row.group.id}
              className="flex items-center gap-4 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{row.group.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {row.group.id}
                </p>
              </div>

              <select
                className="border rounded px-2 py-1 text-sm"
                value={row.selectedNodeType ?? ""}
                onChange={(e) =>
                  updateRow(row.group.id, {
                    selectedNodeType: (e.target.value as NodeType) || null,
                    saved: false,
                  })
                }
                disabled={row.saved}
              >
                <option value="">Select type...</option>
                <option value="org">Organization</option>
                <option value="department">Department</option>
                <option value="team">Team</option>
              </select>

              <select
                className="border rounded px-2 py-1 text-sm"
                value={row.selectedParentId ?? ""}
                onChange={(e) =>
                  updateRow(row.group.id, {
                    selectedParentId: e.target.value || null,
                    saved: false,
                  })
                }
                disabled={row.saved}
              >
                <option value="">No parent</option>
                {assignableParents.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.nodeType})
                  </option>
                ))}
              </select>

              {row.saved ? (
                <Badge className="text-xs bg-green-100 text-green-800">
                  Saved
                </Badge>
              ) : (
                <Button
                  size="sm"
                  disabled={!row.selectedNodeType || row.saving}
                  onClick={() => saveGroup(row)}
                >
                  {row.saving ? "Saving..." : "Save"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
