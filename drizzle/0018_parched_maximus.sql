ALTER TYPE "public"."role_grant_capability" ADD VALUE 'organiser.manage';--> statement-breakpoint
CREATE TABLE "organisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisers_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "organisers_version_positive" CHECK ("organisers"."version" >= 1),
	CONSTRAINT "organisers_name_nonempty" CHECK (char_length(btrim("organisers"."name")) > 0 AND char_length("organisers"."name") <= 120)
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_closed";--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_resource_type_closed";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organiser_id" uuid;--> statement-breakpoint
ALTER TABLE "organisers" ADD CONSTRAINT "organisers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "organisers_tenant_name" ON "organisers" USING btree ("tenant_id","name","id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organiser_same_tenant_fk" FOREIGN KEY ("tenant_id","organiser_id") REFERENCES "public"."organisers"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "events_tenant_organiser" ON "events" USING btree ("tenant_id","organiser_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated', 'fixture.created', 'fixture.changed', 'fixture.postponed', 'fixture.cancelled', 'fixture.completed', 'fixture.abandoned', 'result.draft_created', 'result.draft_changed', 'result.published', 'result.corrected', 'event.created', 'event.changed', 'event.published', 'organiser.created', 'organiser.changed'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_resource_type_closed" CHECK ("audit_events"."resource_type" IN ('publication', 'sport', 'competition', 'team', 'fixture', 'result', 'event', 'organiser'));