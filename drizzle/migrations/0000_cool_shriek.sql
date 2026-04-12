CREATE TYPE "public"."decision_outcome" AS ENUM('allow', 'deny', 'not_applicable', 'error');--> statement-breakpoint
CREATE TYPE "public"."dimension_kind" AS ENUM('numeric', 'rate', 'set', 'boolean', 'temporal');--> statement-breakpoint
CREATE TYPE "public"."domain" AS ENUM('finance', 'communication', 'agent_delegation');--> statement-breakpoint
CREATE TYPE "public"."petition_status" AS ENUM('pending', 'approved', 'denied', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."policy_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TABLE "action_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" "domain" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "action_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "agent_group_memberships" (
	"agent_did" text NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "agent_group_memberships_agent_did_group_id_pk" PRIMARY KEY("agent_did","group_id")
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_did" text NOT NULL,
	"action_type_id" uuid NOT NULL,
	"request_context" jsonb NOT NULL,
	"bundle_hash" text NOT NULL,
	"outcome" "decision_outcome" NOT NULL,
	"reason" text,
	"matched_version_id" uuid,
	"engine_error_code" text,
	"sdk_error_code" text,
	"envelope_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "dimension_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type_id" uuid NOT NULL,
	"dimension_name" text NOT NULL,
	"kind" "dimension_kind" NOT NULL,
	"numeric_max" numeric,
	"rate_limit" integer,
	"rate_window" text,
	"set_members" text[],
	"bool_default" boolean,
	"bool_restrictive" boolean,
	"temporal_expiry" date,
	CONSTRAINT "dim_def_action_name_uniq" UNIQUE("action_type_id","dimension_name")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"node_type" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_org_name_parent_uniq" UNIQUE("org_id","name","parent_id"),
	CONSTRAINT "groups_node_type_check" CHECK ("groups"."node_type" IN ('org', 'department', 'team'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"policy_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_unique" UNIQUE("name"),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "petitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requestor_did" text NOT NULL,
	"action_type_id" uuid NOT NULL,
	"requested_context" jsonb NOT NULL,
	"violated_policy_id" uuid NOT NULL,
	"violated_dimension" text NOT NULL,
	"requested_value" jsonb NOT NULL,
	"justification" text NOT NULL,
	"approver_did" text,
	"approver_group_id" uuid,
	"status" "petition_status" DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"grant_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" "domain" NOT NULL,
	"effect" "policy_effect" NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_org_name_uniq" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "policy_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"group_id" uuid,
	"agent_did" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_target_check" CHECK (("policy_assignments"."group_id" IS NOT NULL AND "policy_assignments"."agent_did" IS NULL) OR ("policy_assignments"."group_id" IS NULL AND "policy_assignments"."agent_did" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"constraints" jsonb NOT NULL,
	"cedar_source" text NOT NULL,
	"cedar_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "agent_group_memberships" ADD CONSTRAINT "agent_group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_action_type_id_action_types_id_fk" FOREIGN KEY ("action_type_id") REFERENCES "public"."action_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_matched_version_id_policy_versions_id_fk" FOREIGN KEY ("matched_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_definitions" ADD CONSTRAINT "dimension_definitions_action_type_id_action_types_id_fk" FOREIGN KEY ("action_type_id") REFERENCES "public"."action_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petitions" ADD CONSTRAINT "petitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petitions" ADD CONSTRAINT "petitions_action_type_id_action_types_id_fk" FOREIGN KEY ("action_type_id") REFERENCES "public"."action_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petitions" ADD CONSTRAINT "petitions_violated_policy_id_policies_id_fk" FOREIGN KEY ("violated_policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petitions" ADD CONSTRAINT "petitions_approver_group_id_groups_id_fk" FOREIGN KEY ("approver_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_log_agent_time_idx" ON "decision_log" USING btree ("agent_did","evaluated_at");--> statement-breakpoint
CREATE INDEX "decision_log_outcome_time_idx" ON "decision_log" USING btree ("outcome","evaluated_at");--> statement-breakpoint
CREATE INDEX "decision_log_bundle_hash_idx" ON "decision_log" USING btree ("bundle_hash");--> statement-breakpoint
CREATE INDEX "petitions_requestor_status_idx" ON "petitions" USING btree ("requestor_did","status");--> statement-breakpoint
CREATE INDEX "petitions_approver_status_idx" ON "petitions" USING btree ("approver_did","status");