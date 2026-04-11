"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import type { Group } from "@/lib/types";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Group[]>("/api/policies/groups")
      .then(setGroups)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const tree = buildTree(groups);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Groups</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
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
