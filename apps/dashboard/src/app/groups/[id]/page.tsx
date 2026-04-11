"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import type { Group, GroupMembership, PolicyAssignment } from "@/lib/types";

interface AncestorRow {
  id: string;
  parent_id: string | null;
  name: string;
  node_type: string;
  depth: number;
}

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMembership[]>([]);
  const [assignments, setAssignments] = useState<PolicyAssignment[]>([]);
  const [ancestors, setAncestors] = useState<AncestorRow[]>([]);
  const [descendants, setDescendants] = useState<AncestorRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [g, m, a, anc, desc] = await Promise.all([
          apiFetch<Group>(`/api/policies/groups/${params.id}`),
          apiFetch<GroupMembership[]>(`/api/policies/groups/${params.id}/members`),
          apiFetch<PolicyAssignment[]>(`/api/policies/assignments?groupId=${params.id}`),
          apiFetch<AncestorRow[]>(`/api/policies/groups/${params.id}/ancestors`),
          apiFetch<AncestorRow[]>(`/api/policies/groups/${params.id}/descendants`),
        ]);
        setGroup(g);
        setMembers(m);
        setAssignments(a);
        setAncestors(anc);
        setDescendants(desc);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!group) return <p className="text-sm text-destructive">Group not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <Badge variant="outline">{group.nodeType}</Badge>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members in this group.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <Card key={m.agentDid}>
                  <CardContent className="py-3">
                    <Link
                      href={`/agents/${encodeURIComponent(m.agentDid)}`}
                      className="text-sm font-mono hover:underline"
                    >
                      {m.agentDid}
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="policies" className="mt-4">
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies assigned to this group.</p>
          ) : (
            <div className="space-y-1">
              {assignments.map((a) => (
                <Card key={a.id}>
                  <CardContent className="py-3">
                    <Link
                      href={`/policies/${a.policyId}`}
                      className="text-sm font-mono hover:underline"
                    >
                      {a.policyId}
                    </Link>
                    <span className="text-xs text-muted-foreground ml-2">
                      assigned {new Date(a.assignedAt).toLocaleDateString()}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="hierarchy" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Ancestors</CardTitle>
            </CardHeader>
            <CardContent>
              {ancestors.length <= 1 ? (
                <p className="text-sm text-muted-foreground">No ancestors (root group).</p>
              ) : (
                <div className="space-y-1">
                  {ancestors.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 text-sm"
                      style={{ paddingLeft: `${a.depth * 16}px` }}
                    >
                      {a.id === params.id ? (
                        <span className="font-semibold">{a.name}</span>
                      ) : (
                        <Link
                          href={`/groups/${a.id}`}
                          className="hover:underline"
                        >
                          {a.name}
                        </Link>
                      )}
                      <Badge variant="outline" className="text-xs">{a.node_type}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-sm">Descendants</CardTitle>
            </CardHeader>
            <CardContent>
              {descendants.length <= 1 ? (
                <p className="text-sm text-muted-foreground">No descendants.</p>
              ) : (
                <div className="space-y-1">
                  {descendants.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 text-sm"
                      style={{ paddingLeft: `${d.depth * 16}px` }}
                    >
                      {d.id === params.id ? (
                        <span className="font-semibold">{d.name}</span>
                      ) : (
                        <Link
                          href={`/groups/${d.id}`}
                          className="hover:underline"
                        >
                          {d.name}
                        </Link>
                      )}
                      <Badge variant="outline" className="text-xs">{d.node_type}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
