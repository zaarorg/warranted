"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type { Organization, Policy } from "@/lib/types";

const DOMAINS = ["finance", "communication", "agent_delegation"] as const;
const EFFECTS = ["allow", "deny"] as const;

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [org, setOrg] = useState<Organization | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    domain: "finance" as Policy["domain"],
    effect: "deny" as Policy["effect"],
  });

  function loadData() {
    setLoading(true);
    Promise.all([
      apiFetch<Policy[]>("/api/policies/rules"),
      apiFetch<Organization[]>("/api/policies/organizations"),
    ])
      .then(([p, orgs]) => {
        setPolicies(p);
        setOrg(orgs[0] ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate() {
    if (!form.name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    if (!org) {
      setCreateError("No organization found. Create one in the Groups page first.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch<Policy>("/api/policies/rules", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          orgId: org.id,
          domain: form.domain,
          effect: form.effect,
        }),
      });
      setDialogOpen(false);
      setForm({ name: "", domain: "finance", effect: "deny" });
      loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create policy");
    } finally {
      setCreating(false);
    }
  }

  const filtered = policies.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.domain.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Policies</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>Create Policy</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Policy</DialogTitle>
              <DialogDescription>
                Define a new governance policy for your organization.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="e.g. gpu-spending-cap"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Domain</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.domain}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, domain: e.target.value as Policy["domain"] }))
                  }
                >
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Effect</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.effect}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, effect: e.target.value as Policy["effect"] }))
                  }
                >
                  {EFFECTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>

              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Input
        placeholder="Search policies..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Effect</TableHead>
              <TableHead>Active Version</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    href={`/policies/${p.id}`}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{p.domain}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={p.effect === "allow" ? "default" : "destructive"}>
                    {p.effect}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {p.activeVersionId ? p.activeVersionId.slice(0, 8) + "..." : "none"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No policies found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
