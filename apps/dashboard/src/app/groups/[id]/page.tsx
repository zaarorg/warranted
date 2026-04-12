"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import type { Group, GroupMembership, Policy, PolicyAssignment } from "@/lib/types";

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

  /* assign-policy dialog state */
  const [assignOpen, setAssignOpen] = useState(false);
  const [allPolicies, setAllPolicies] = useState<Policy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  /* add-member dialog state */
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberDid, setMemberDid] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  /* add-child-group dialog state */
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [childForm, setChildForm] = useState({ name: "", nodeType: "department" as "department" | "team" });
  const [addingChild, setAddingChild] = useState(false);
  const [addChildError, setAddChildError] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    const a = await apiFetch<PolicyAssignment[]>(
      `/api/policies/assignments?groupId=${params.id}`,
    );
    setAssignments(a);
  }, [params.id]);

  const loadMembers = useCallback(async () => {
    const m = await apiFetch<GroupMembership[]>(
      `/api/policies/groups/${params.id}/members`,
    );
    setMembers(m);
  }, [params.id]);

  const loadDescendants = useCallback(async () => {
    const d = await apiFetch<AncestorRow[]>(
      `/api/policies/groups/${params.id}/descendants`,
    );
    setDescendants(d);
  }, [params.id]);

  async function handleAddMember() {
    if (!memberDid.trim()) {
      setAddMemberError("Agent DID is required.");
      return;
    }
    setAddingMember(true);
    setAddMemberError(null);
    try {
      await apiFetch(`/api/policies/groups/${params.id}/members`, {
        method: "POST",
        body: JSON.stringify({ agentDid: memberDid.trim() }),
      });
      setAddMemberOpen(false);
      setMemberDid("");
      await loadMembers();
    } catch (err) {
      setAddMemberError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleAddChild() {
    if (!childForm.name.trim()) {
      setAddChildError("Name is required.");
      return;
    }
    if (!group) return;
    setAddingChild(true);
    setAddChildError(null);
    try {
      await apiFetch("/api/policies/groups", {
        method: "POST",
        body: JSON.stringify({
          orgId: group.orgId,
          name: childForm.name.trim(),
          nodeType: childForm.nodeType,
          parentId: params.id,
        }),
      });
      setAddChildOpen(false);
      setChildForm({ name: "", nodeType: "department" });
      await loadDescendants();
    } catch (err) {
      setAddChildError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setAddingChild(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const [g, m, a, anc, desc, policies] = await Promise.all([
          apiFetch<Group>(`/api/policies/groups/${params.id}`),
          apiFetch<GroupMembership[]>(`/api/policies/groups/${params.id}/members`),
          apiFetch<PolicyAssignment[]>(`/api/policies/assignments?groupId=${params.id}`),
          apiFetch<AncestorRow[]>(`/api/policies/groups/${params.id}/ancestors`),
          apiFetch<AncestorRow[]>(`/api/policies/groups/${params.id}/descendants`),
          apiFetch<Policy[]>("/api/policies/rules"),
        ]);
        setGroup(g);
        setMembers(m);
        setAssignments(a);
        setAncestors(anc);
        setDescendants(desc);
        setAllPolicies(policies);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  /* Load available policies when the assign dialog opens */
  useEffect(() => {
    if (!assignOpen) return;
    apiFetch<Policy[]>("/api/policies/rules")
      .then(setAllPolicies)
      .catch(console.error);
  }, [assignOpen]);

  async function handleAssign() {
    if (!selectedPolicyId) {
      setAssignError("Select a policy.");
      return;
    }
    setAssigning(true);
    setAssignError(null);
    try {
      await apiFetch<PolicyAssignment>("/api/policies/assignments", {
        method: "POST",
        body: JSON.stringify({ policyId: selectedPolicyId, groupId: params.id }),
      });
      setAssignOpen(false);
      setSelectedPolicyId("");
      await loadAssignments();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign policy");
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemove(assignmentId: string) {
    setRemovingId(assignmentId);
    try {
      await apiFetch(`/api/policies/assignments/${assignmentId}`, {
        method: "DELETE",
      });
      await loadAssignments();
    } catch (err) {
      console.error("Failed to remove assignment", err);
    } finally {
      setRemovingId(null);
    }
  }

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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"}
            </h2>
            <Dialog open={addMemberOpen} onOpenChange={(open) => { setAddMemberOpen(open); if (!open) { setAddMemberError(null); setMemberDid(""); } }}>
              <DialogTrigger render={<Button size="sm" />}>Add Member</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Member</DialogTitle>
                  <DialogDescription>
                    Add an agent to this group by DID.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Agent DID</label>
                    <Input
                      placeholder="did:mesh:..."
                      value={memberDid}
                      onChange={(e) => setMemberDid(e.target.value)}
                    />
                  </div>
                  {addMemberError && (
                    <p className="text-sm text-destructive">{addMemberError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={handleAddMember} disabled={addingMember}>
                    {addingMember ? "Adding..." : "Add"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {assignments.length} {assignments.length === 1 ? "policy" : "policies"} assigned
            </h2>
            <Dialog open={assignOpen} onOpenChange={(open) => { setAssignOpen(open); if (!open) { setAssignError(null); setSelectedPolicyId(""); } }}>
              <DialogTrigger render={<Button size="sm" />}>Assign Policy</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Policy</DialogTitle>
                  <DialogDescription>
                    Select a policy to assign to this group.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Policy</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={selectedPolicyId}
                      onChange={(e) => setSelectedPolicyId(e.target.value)}
                    >
                      <option value="">Select a policy...</option>
                      {allPolicies
                        .filter((p) => !assignments.some((a) => a.policyId === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.domain}, {p.effect})
                          </option>
                        ))}
                    </select>
                  </div>

                  {assignError && (
                    <p className="text-sm text-destructive">{assignError}</p>
                  )}
                </div>

                <DialogFooter>
                  <Button onClick={handleAssign} disabled={assigning}>
                    {assigning ? "Assigning..." : "Assign"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies assigned to this group.</p>
          ) : (
            <div className="space-y-1">
              {assignments.map((a) => {
                const policy = allPolicies.find((p) => p.id === a.policyId);
                return (
                  <Card key={a.id}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div>
                        <Link
                          href={`/policies/${a.policyId}`}
                          className="text-sm font-mono hover:underline"
                        >
                          {policy ? policy.name : a.policyId}
                        </Link>
                        <span className="text-xs text-muted-foreground ml-2">
                          assigned {new Date(a.assignedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={removingId === a.id}
                        onClick={() => handleRemove(a.id)}
                      >
                        {removingId === a.id ? "Removing..." : "Remove"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="hierarchy" className="mt-4">
          <div className="flex items-center justify-end mb-3">
            <Dialog open={addChildOpen} onOpenChange={(open) => { setAddChildOpen(open); if (!open) { setAddChildError(null); setChildForm({ name: "", nodeType: "department" }); } }}>
              <DialogTrigger render={<Button size="sm" />}>Add Child Group</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Child Group</DialogTitle>
                  <DialogDescription>
                    Create a new group under {group.name}.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Name</label>
                    <Input
                      placeholder="e.g. Engineering"
                      value={childForm.name}
                      onChange={(e) => setChildForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Type</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={childForm.nodeType}
                      onChange={(e) => setChildForm((f) => ({ ...f, nodeType: e.target.value as "department" | "team" }))}
                    >
                      <option value="department">department</option>
                      <option value="team">team</option>
                    </select>
                  </div>
                  {addChildError && (
                    <p className="text-sm text-destructive">{addChildError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={handleAddChild} disabled={addingChild}>
                    {addingChild ? "Creating..." : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

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
