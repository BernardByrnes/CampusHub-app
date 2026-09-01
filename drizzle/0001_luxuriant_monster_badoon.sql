CREATE TYPE "public"."publication_lifecycle" AS ENUM('draft', 'scheduled', 'published', 'expired', 'archived');--> statement-breakpoint
CREATE TYPE "public"."publication_type" AS ENUM('notice', 'news');--> statement-breakpoint
CREATE TYPE "public"."publication_visibility" AS ENUM('PUBLIC', 'MEMBERS', 'VERIFIED_MEMBERS');--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "publication_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"visibility" "publication_visibility" DEFAULT 'MEMBERS' NOT NULL,
	"lifecycle" "publication_lifecycle" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_title_nonempty" CHECK (char_length(btrim("publications"."title")) > 0),
	CONSTRAINT "publications_body_nonempty" CHECK (char_length(btrim("publications"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "publications_tenant_id_id" ON "publications" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "publications_tenant_lifecycle" ON "publications" USING btree ("tenant_id","lifecycle");