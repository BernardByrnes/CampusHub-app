CREATE TYPE "public"."fixture_state" AS ENUM('scheduled', 'postponed', 'cancelled', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"venue" text NOT NULL,
	"state" "fixture_state" DEFAULT 'scheduled' NOT NULL,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixtures_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "fixtures_home_away_different" CHECK ("fixtures"."home_team_id" <> "fixtures"."away_team_id"),
	CONSTRAINT "fixtures_venue_nonempty" CHECK (char_length(btrim("fixtures"."venue")) > 0 AND char_length("fixtures"."venue") <= 200),
	CONSTRAINT "fixtures_reason_shape" CHECK ("fixtures"."reason" IS NULL OR (char_length(btrim("fixtures"."reason")) > 0 AND char_length("fixtures"."reason") <= 500)),
	CONSTRAINT "fixtures_version_positive" CHECK ("fixtures"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_closed";--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_resource_type_closed";--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_competition_same_tenant_fk" FOREIGN KEY ("tenant_id","competition_id") REFERENCES "public"."competitions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_same_tenant_fk" FOREIGN KEY ("tenant_id","home_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_same_tenant_fk" FOREIGN KEY ("tenant_id","away_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_campus_same_tenant_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "fixtures_tenant_starts_at" ON "fixtures" USING btree ("tenant_id","starts_at","id");--> statement-breakpoint
CREATE INDEX "fixtures_tenant_state" ON "fixtures" USING btree ("tenant_id","state","starts_at");--> statement-breakpoint
CREATE INDEX "fixtures_tenant_competition" ON "fixtures" USING btree ("tenant_id","competition_id");--> statement-breakpoint
CREATE INDEX "fixtures_tenant_home_team" ON "fixtures" USING btree ("tenant_id","home_team_id");--> statement-breakpoint
CREATE INDEX "fixtures_tenant_away_team" ON "fixtures" USING btree ("tenant_id","away_team_id");--> statement-breakpoint
CREATE INDEX "fixtures_tenant_campus" ON "fixtures" USING btree ("tenant_id","campus_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated', 'fixture.created', 'fixture.changed', 'fixture.postponed', 'fixture.cancelled', 'fixture.completed', 'fixture.abandoned'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_resource_type_closed" CHECK ("audit_events"."resource_type" IN ('publication', 'sport', 'competition', 'team', 'fixture'));