CREATE TYPE "public"."event_lifecycle" AS ENUM('draft', 'published', 'postponed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."role_grant_capability" ADD VALUE 'event.manage';--> statement-breakpoint
CREATE TABLE "event_audience_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"dimension" "publication_audience_dimension" NOT NULL,
	"provenance_policy" "publication_audience_provenance_policy" NOT NULL,
	"campus_id" uuid,
	"academic_division_id" uuid,
	"programme_id" uuid,
	"academic_year" integer,
	"residence_target" "publication_audience_residence_target",
	"residence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_audience_criteria_payload_shape" CHECK ((
        ("event_audience_criteria"."dimension" = 'campus' AND "event_audience_criteria"."campus_id" IS NOT NULL AND "event_audience_criteria"."academic_division_id" IS NULL AND "event_audience_criteria"."programme_id" IS NULL AND "event_audience_criteria"."academic_year" IS NULL AND "event_audience_criteria"."residence_target" IS NULL AND "event_audience_criteria"."residence_id" IS NULL)
        OR ("event_audience_criteria"."dimension" = 'academic_division' AND "event_audience_criteria"."campus_id" IS NULL AND "event_audience_criteria"."academic_division_id" IS NOT NULL AND "event_audience_criteria"."programme_id" IS NULL AND "event_audience_criteria"."academic_year" IS NULL AND "event_audience_criteria"."residence_target" IS NULL AND "event_audience_criteria"."residence_id" IS NULL)
        OR ("event_audience_criteria"."dimension" = 'programme' AND "event_audience_criteria"."campus_id" IS NULL AND "event_audience_criteria"."academic_division_id" IS NULL AND "event_audience_criteria"."programme_id" IS NOT NULL AND "event_audience_criteria"."academic_year" IS NULL AND "event_audience_criteria"."residence_target" IS NULL AND "event_audience_criteria"."residence_id" IS NULL)
        OR ("event_audience_criteria"."dimension" = 'academic_year' AND "event_audience_criteria"."campus_id" IS NULL AND "event_audience_criteria"."academic_division_id" IS NULL AND "event_audience_criteria"."programme_id" IS NULL AND "event_audience_criteria"."academic_year" >= 1 AND "event_audience_criteria"."residence_target" IS NULL AND "event_audience_criteria"."residence_id" IS NULL)
        OR ("event_audience_criteria"."dimension" = 'residence' AND "event_audience_criteria"."campus_id" IS NULL AND "event_audience_criteria"."academic_division_id" IS NULL AND "event_audience_criteria"."programme_id" IS NULL AND "event_audience_criteria"."academic_year" IS NULL AND "event_audience_criteria"."residence_target" IS NOT NULL AND (("event_audience_criteria"."residence_target" = 'specific_residence' AND "event_audience_criteria"."residence_id" IS NOT NULL) OR ("event_audience_criteria"."residence_target" IN ('any_resident', 'non_resident') AND "event_audience_criteria"."residence_id" IS NULL)))
      ))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"venue" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"campus_id" uuid NOT NULL,
	"visibility" "publication_visibility" DEFAULT 'MEMBERS' NOT NULL,
	"audience_mode" "publication_audience_mode" NOT NULL,
	"rsvp_enabled" boolean DEFAULT false NOT NULL,
	"lifecycle" "event_lifecycle" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "events_version_positive" CHECK ("events"."version" >= 1),
	CONSTRAINT "events_title_nonempty" CHECK (char_length(btrim("events"."title")) > 0 AND char_length("events"."title") <= 160),
	CONSTRAINT "events_description_nonempty" CHECK (char_length(btrim("events"."description")) > 0 AND char_length("events"."description") <= 5000),
	CONSTRAINT "events_venue_nonempty" CHECK (char_length(btrim("events"."venue")) > 0 AND char_length("events"."venue") <= 200),
	CONSTRAINT "events_ends_after_start" CHECK ("events"."ends_at" IS NULL OR "events"."ends_at" > "events"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_closed";--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_resource_type_closed";--> statement-breakpoint
ALTER TABLE "event_audience_criteria" ADD CONSTRAINT "event_audience_criteria_event_same_tenant_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_audience_criteria" ADD CONSTRAINT "event_audience_criteria_campus_same_tenant_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_audience_criteria" ADD CONSTRAINT "event_audience_criteria_division_same_tenant_fk" FOREIGN KEY ("tenant_id","academic_division_id") REFERENCES "public"."academic_divisions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_audience_criteria" ADD CONSTRAINT "event_audience_criteria_programme_same_tenant_fk" FOREIGN KEY ("tenant_id","programme_id") REFERENCES "public"."programmes"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_audience_criteria" ADD CONSTRAINT "event_audience_criteria_residence_same_tenant_fk" FOREIGN KEY ("tenant_id","residence_id") REFERENCES "public"."residences"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_campus_same_tenant_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "event_audience_criteria_tenant_event" ON "event_audience_criteria" USING btree ("tenant_id","event_id","dimension","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_criteria_campus_unique" ON "event_audience_criteria" USING btree ("tenant_id","event_id","campus_id") WHERE "event_audience_criteria"."dimension" = 'campus';--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_criteria_division_unique" ON "event_audience_criteria" USING btree ("tenant_id","event_id","academic_division_id") WHERE "event_audience_criteria"."dimension" = 'academic_division';--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_criteria_programme_unique" ON "event_audience_criteria" USING btree ("tenant_id","event_id","programme_id") WHERE "event_audience_criteria"."dimension" = 'programme';--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_criteria_academic_year_unique" ON "event_audience_criteria" USING btree ("tenant_id","event_id","academic_year") WHERE "event_audience_criteria"."dimension" = 'academic_year';--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_criteria_specific_residence_unique" ON "event_audience_criteria" USING btree ("tenant_id","event_id","residence_id") WHERE "event_audience_criteria"."dimension" = 'residence' AND "event_audience_criteria"."residence_target" = 'specific_residence';--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_criteria_residence_target_unique" ON "event_audience_criteria" USING btree ("tenant_id","event_id","residence_target") WHERE "event_audience_criteria"."dimension" = 'residence' AND "event_audience_criteria"."residence_target" IN ('any_resident', 'non_resident');--> statement-breakpoint
CREATE INDEX "events_tenant_lifecycle_starts_at" ON "events" USING btree ("tenant_id","lifecycle","starts_at","id");--> statement-breakpoint
CREATE INDEX "events_tenant_campus_lifecycle" ON "events" USING btree ("tenant_id","campus_id","lifecycle");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated', 'fixture.created', 'fixture.changed', 'fixture.postponed', 'fixture.cancelled', 'fixture.completed', 'fixture.abandoned', 'result.draft_created', 'result.draft_changed', 'result.published', 'result.corrected', 'event.created', 'event.changed', 'event.published'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_resource_type_closed" CHECK ("audit_events"."resource_type" IN ('publication', 'sport', 'competition', 'team', 'fixture', 'result', 'event'));