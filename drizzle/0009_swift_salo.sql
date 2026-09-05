CREATE TYPE "public"."guild_term_status" AS ENUM('upcoming', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."role_grant_capability" AS ENUM('publication.create', 'publication.edit', 'publication.publish', 'publication.priority_publish', 'publication.retract');--> statement-breakpoint
CREATE TYPE "public"."role_grant_module_scope" AS ENUM('publication', 'event', 'opportunity', 'sports', 'poll', 'voice', 'quiz', 'sponsorship', 'tenant', 'verification', 'analytics', 'notification', 'export', 'search');--> statement-breakpoint
CREATE TYPE "public"."role_grant_role" AS ENUM('publisher', 'guild_administrator');--> statement-breakpoint
CREATE TABLE "guild_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "guild_term_status" DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_terms_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "guild_terms_label_nonempty" CHECK (char_length(btrim("guild_terms"."label")) > 0),
	CONSTRAINT "guild_terms_range_valid" CHECK ("guild_terms"."starts_at" < "guild_terms"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guild_term_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" "role_grant_role" NOT NULL,
	"capability" "role_grant_capability" NOT NULL,
	"module_scope" "role_grant_module_scope" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grants_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "role_grants_tenant_term_membership_capability_module_unique" UNIQUE("tenant_id","guild_term_id","membership_id","capability","module_scope"),
	CONSTRAINT "role_grants_expiry_after_creation" CHECK ("role_grants"."expires_at" > "role_grants"."created_at"),
	CONSTRAINT "role_grants_revocation_after_creation" CHECK ("role_grants"."revoked_at" IS NULL OR "role_grants"."revoked_at" >= "role_grants"."created_at")
);
--> statement-breakpoint
ALTER TABLE "guild_terms" ADD CONSTRAINT "guild_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_guild_term_same_tenant_fk" FOREIGN KEY ("tenant_id","guild_term_id") REFERENCES "public"."guild_terms"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_terms_one_active_per_tenant" ON "guild_terms" USING btree ("tenant_id") WHERE "guild_terms"."status" = 'active';--> statement-breakpoint
CREATE INDEX "guild_terms_tenant_status" ON "guild_terms" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "role_grants_tenant_membership_capability" ON "role_grants" USING btree ("tenant_id","membership_id","capability","module_scope");
