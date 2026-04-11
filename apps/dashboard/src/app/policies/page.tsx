"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { Policy } from "@/lib/types";

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Policy[]>("/api/policies/rules")
      .then(setPolicies)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = policies.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.domain.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Policies</h1>
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
