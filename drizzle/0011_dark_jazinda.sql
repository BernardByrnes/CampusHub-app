CREATE TYPE "public"."publication_audit_event_type" AS ENUM('published');--> statement-breakpoint
CREATE TABLE "publication_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"actor_identity_subject_id" text NOT NULL,
	"event_type" "publication_audit_event_type" NOT NULL,
	"publication_version" integer NOT NULL,
	"confirmed_recipient_count" integer NOT NULL,
	"audience_snapshot" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_audit_events_actor_identity_nonempty" CHECK (char_length(btrim("publication_audit_events"."actor_identity_subject_id")) > 0),
	CONSTRAINT "publication_audit_events_version_positive" CHECK ("publication_audit_events"."publication_version" >= 1),
	CONSTRAINT "publication_audit_events_recipient_count_nonnegative" CHECK ("publication_audit_events"."confirmed_recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "publication_audit_events" ADD CONSTRAINT "publication_audit_events_publication_same_tenant_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "publication_audit_events" ADD CONSTRAINT "publication_audit_events_actor_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "publication_audit_events_tenant_occurred_at" ON "publication_audit_events" USING btree ("tenant_id","occurred_at","id");