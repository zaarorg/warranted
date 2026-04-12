-- Phase 1: WorkOS Integration
-- Organizations: WorkOS binding columns
ALTER TABLE "organizations" ADD COLUMN "workos_org_id" text UNIQUE;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "workos_directory_id" text;--> statement-breakpoint

-- Webhook event dedup table
CREATE TABLE "workos_processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL UNIQUE,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- SCIM sync state table
CREATE TABLE "wos_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id"),
	"last_sync_at" timestamp with time zone,
	"sync_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Groups: update nodeType CHECK to include 'unassigned', set default
ALTER TABLE "groups" DROP CONSTRAINT "groups_node_type_check";--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_node_type_check"
	CHECK ("groups"."node_type" IN ('org', 'department', 'team', 'unassigned'));--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "node_type" SET DEFAULT 'unassigned';
