CREATE TYPE "public"."competition_table_mode" AS ENUM('none', 'manual');--> statement-breakpoint
CREATE TYPE "public"."sport_lifecycle" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TYPE "public"."role_grant_capability" ADD VALUE 'sport.manage';--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sport_id" uuid NOT NULL,
	"name" text NOT NULL,
	"season_label" text NOT NULL,
	"campus_id" uuid NOT NULL,
	"table_mode" "competition_table_mode" DEFAULT 'none' NOT NULL,
	"status" "sport_lifecycle" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "competitions_name_nonempty" CHECK (char_length(btrim("competitions"."name")) > 0 AND char_length("competitions"."name") <= 120),
	CONSTRAINT "competitions_season_label_nonempty" CHECK (char_length(btrim("competitions"."season_label")) > 0 AND char_length("competitions"."season_label") <= 80),
	CONSTRAINT "competitions_version_positive" CHECK ("competitions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "sport_lifecycle" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sports_name_nonempty" CHECK (char_length(btrim("sports"."name")) > 0 AND char_length("sports"."name") <= 120),
	CONSTRAINT "sports_version_positive" CHECK ("sports"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sport_id" uuid NOT NULL,
	"name" text NOT NULL,
	"affiliation_label" text,
	"status" "sport_lifecycle" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "teams_name_nonempty" CHECK (char_length(btrim("teams"."name")) > 0 AND char_length("teams"."name") <= 120),
	CONSTRAINT "teams_affiliation_label_shape" CHECK ("teams"."affiliation_label" IS NULL OR (char_length(btrim("teams"."affiliation_label")) > 0 AND char_length("teams"."affiliation_label") <= 160)),
	CONSTRAINT "teams_version_positive" CHECK ("teams"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_closed";--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_resource_type_closed";--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_same_tenant_fk" FOREIGN KEY ("tenant_id","sport_id") REFERENCES "public"."sports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_campus_same_tenant_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sports" ADD CONSTRAINT "sports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_sport_same_tenant_fk" FOREIGN KEY ("tenant_id","sport_id") REFERENCES "public"."sports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "competitions_tenant_sport_status" ON "competitions" USING btree ("tenant_id","sport_id","status");--> statement-breakpoint
CREATE INDEX "competitions_tenant_campus_status" ON "competitions" USING btree ("tenant_id","campus_id","status");--> statement-breakpoint
CREATE INDEX "sports_tenant_status" ON "sports" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "sports_tenant_name" ON "sports" USING btree ("tenant_id","name","id");--> statement-breakpoint
CREATE INDEX "teams_tenant_sport_status" ON "teams" USING btree ("tenant_id","sport_id","status");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_resource_type_closed" CHECK ("audit_events"."resource_type" IN ('publication', 'sport', 'competition', 'team'));