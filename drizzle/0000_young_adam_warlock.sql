CREATE TYPE "public"."membership_assurance_level" AS ENUM('L0', 'L1', 'L2', 'L3');--> statement-breakpoint
CREATE TYPE "public"."membership_lifecycle" AS ENUM('unverified', 'pending_review', 'verified', 'stale', 'on_leave', 'alumni', 'transferred_out', 'participation_suspended', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tenant_lifecycle" AS ENUM('pilot', 'active', 'grace', 'suspended', 'archived');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_subject_id" text NOT NULL,
	"assurance_level" "membership_assurance_level" DEFAULT 'L0' NOT NULL,
	"lifecycle" "membership_lifecycle" DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_identity_subject_nonempty" CHECK (char_length(btrim("memberships"."identity_subject_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "tenant_lifecycle" DEFAULT 'pilot' NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("tenants"."slug") <= 80),
	CONSTRAINT "tenants_display_name_nonempty" CHECK (char_length(btrim("tenants"."display_name")) > 0),
	CONSTRAINT "tenants_timezone_nonempty" CHECK (char_length(btrim("tenants"."timezone")) > 0)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_identity_unique" ON "memberships" USING btree ("tenant_id","identity_subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" USING btree ("slug");