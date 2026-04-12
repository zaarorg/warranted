"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import type { Group, Organization } from "@/lib/types";

interface TreeNode extends Group {
  children: TreeNode[];
}

function buildTree(groups: Group[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const g of groups) {
    map.set(g.id, { ...g, children: [] });
  }

  for (const g of groups) {
    const node = map.get(g.id)!;
    if (g.parentId && map.has(g.parentId)) {
      map.get(g.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "" });

  function loadData() {
    setLoading(true);
    Promise.all([
      apiFetch<Group[]>("/api/policies/groups"),
      apiFetch<Organization[]>("/api/policies/organizations"),
    ])
      .then(([g, o]) => {
        setGroups(g);
        setOrgs(o);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreateOrg() {
    if (!form.name.trim() || !form.slug.trim()) {
      setCreateError("Name and slug are required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch("/api/policies/organizations", {
        method: "POST",
        body: JSON.stringify({ name: form.name.trim(), slug: form.slug.trim() }),
      });
      setDialogOpen(false);
      setForm({ name: "", slug: "" });
      loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setCreating(false);
    }
  }

  const tree = buildTree(groups);
  const hasOrg = orgs.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Groups</h1>
        {!loading && !hasOrg && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />}>Create Organization</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Organization</DialogTitle>
                <DialogDescription>
                  Set up your organization to start managing groups, agents, and policies.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="e.g. Acme Corp"
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((f) => ({
                        ...f,
                        name,
                        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                      }));
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Slug</label>
                  <Input
                    placeholder="e.g. acme-corp"
                    value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, numbers, and hyphens only.
                  </p>
                </div>

                {createError && (
                  <p className="text-sm text-destructive">{createError}</p>
                )}
              </div>

              <DialogFooter>
                <Button onClick={handleCreateOrg} disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !hasOrg ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No organization found. Create one to get started.
          </p>
        </div>
      ) : tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups found.</p>
      ) : (
        <div className="space-y-1">
          {tree.map((node) => (
            <GroupTreeNode key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupTreeNode({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <Link
          href={`/groups/${node.id}`}
          className="font-medium text-sm hover:underline"
        >
          {node.name}
        </Link>
        <Badge variant="outline" className="text-xs">
          {node.nodeType}
        </Badge>
      </div>
      {node.children.map((child) => (
        <GroupTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
