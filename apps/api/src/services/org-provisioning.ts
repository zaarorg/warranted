import { eq, like } from "drizzle-orm";
import { WorkOS } from "@workos-inc/node";
import { organizations, groups } from "@warranted/rules-engine";
import type { DrizzleDB } from "@warranted/rules-engine";

const workos = new WorkOS(process.env.WORKOS_API_KEY);

/**
 * Converts a name to a kebab-case slug.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Ensures an org exists for the given WorkOS org ID.
 * If no org found, fetches org name from WorkOS and creates one.
 * Handles slug collisions by appending numeric suffix.
 *
 * Returns the org's internal UUID.
 */
export async function ensureOrg(
  db: DrizzleDB,
  workosOrgId: string,
): Promise<string> {
  // Check if org already exists
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.workosOrgId, workosOrgId));

  if (existing.length > 0) {
    return existing[0]!.id;
  }

  // Fetch org name from WorkOS
  const workosOrg = await workos.organizations.getOrganization(workosOrgId);
  const orgName = workosOrg.name;
  const baseSlug = toSlug(orgName);

  // Find a unique slug (handle collisions)
  const slug = await findUniqueSlug(db, baseSlug);

  // Create org + root group in a transaction
  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: orgName,
        slug,
        workosOrgId,
        policyVersion: 0,
      })
      .returning();

    await tx.insert(groups).values({
      orgId: org!.id,
      name: orgName,
      nodeType: "org",
      parentId: null,
    });

    return org!;
  });

  return result.id;
}

async function findUniqueSlug(db: DrizzleDB, baseSlug: string): Promise<string> {
  // Check if base slug is available
  const baseCheck = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.slug, baseSlug));

  if (baseCheck.length === 0) {
    return baseSlug;
  }

  // Find existing slugs that match the pattern
  const similar = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(like(organizations.slug, `${baseSlug}-%`));

  const usedSuffixes = similar
    .map((r) => {
      const match = r.slug.match(new RegExp(`^${baseSlug}-(\\d+)$`));
      return match ? parseInt(match[1]!, 10) : 0;
    })
    .filter((n) => n > 0);

  const nextSuffix = usedSuffixes.length > 0 ? Math.max(...usedSuffixes) + 1 : 2;
  return `${baseSlug}-${nextSuffix}`;
}
