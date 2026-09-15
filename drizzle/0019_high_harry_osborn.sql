-- CH-EVT-004 migration phase 1: read-only provenance preflight. Existing
-- published Events must have exactly one matching pre-CH-EVT-004 publication
-- audit fact. Drafts are valid without a baseline; other lifecycle values are
-- rejected rather than being guessed into history.
DO $$
DECLARE
  event_row record;
  matching_publication_count integer;
  contradictory_publication_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.events
    WHERE lifecycle IN ('postponed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'CH-EVT-004 preflight found an unsupported pre-feature Event lifecycle';
  END IF;

  FOR event_row IN
    SELECT id, tenant_id, version
    FROM public.events
    WHERE lifecycle = 'published'
  LOOP
    SELECT count(*)::integer
    INTO matching_publication_count
    FROM public.audit_events AS audit
    WHERE audit.tenant_id = event_row.tenant_id
      AND audit.event_type = 'event.published'
      AND audit.resource_type = 'event'
      AND audit.resource_id = event_row.id
      AND audit.resource_version = event_row.version
      AND audit.event_facts->>'action' = 'published'
      AND audit.event_facts->>'lifecycle' = 'published'
      AND audit.event_facts->>'version' ~ '^[0-9]+$'
      AND (audit.event_facts->>'version')::integer = event_row.version;

    IF matching_publication_count <> 1 THEN
      RAISE EXCEPTION 'CH-EVT-004 requires exactly one matching event.published audit fact for Event %', event_row.id;
    END IF;

    SELECT count(*)::integer
    INTO contradictory_publication_count
    FROM public.audit_events AS audit
    WHERE audit.event_type = 'event.published'
      AND audit.resource_type = 'event'
      AND audit.resource_id = event_row.id
      AND (
        audit.tenant_id <> event_row.tenant_id
        OR audit.resource_version <> event_row.version
        OR audit.event_facts->>'action' <> 'published'
        OR audit.event_facts->>'lifecycle' <> 'published'
        OR audit.event_facts->>'version' !~ '^[0-9]+$'
        OR (audit.event_facts->>'version')::integer <> event_row.version
      );

    IF contradictory_publication_count <> 0 THEN
      RAISE EXCEPTION 'CH-EVT-004 found contradictory event.published audit provenance for Event %', event_row.id;
    END IF;
  END LOOP;
END;
$$;--> statement-breakpoint

-- CH-EVT-004 migration phase 2: create the immutable Product history shape.
CREATE TABLE "event_lifecycle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_version" integer NOT NULL,
	"from_lifecycle" "event_lifecycle" NOT NULL,
	"to_lifecycle" "event_lifecycle" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"postponed_from_starts_at" timestamp with time zone,
	"reason" text,
	"cancellation_retention_until" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_lifecycle_history_tenant_event_sequence_unique" UNIQUE("tenant_id","event_id","sequence"),
	CONSTRAINT "event_lifecycle_history_tenant_event_version_unique" UNIQUE("tenant_id","event_id","event_version"),
	CONSTRAINT "event_lifecycle_history_sequence_positive" CHECK ("event_lifecycle_history"."sequence" >= 1),
	CONSTRAINT "event_lifecycle_history_event_version_positive" CHECK ("event_lifecycle_history"."event_version" >= 1),
	CONSTRAINT "event_lifecycle_history_schedule_order" CHECK ("event_lifecycle_history"."ends_at" IS NULL OR "event_lifecycle_history"."ends_at" > "event_lifecycle_history"."starts_at"),
	CONSTRAINT "event_lifecycle_history_transition_shape" CHECK ((
      ("event_lifecycle_history"."from_lifecycle" = 'draft' AND "event_lifecycle_history"."to_lifecycle" = 'published' AND "event_lifecycle_history"."postponed_from_starts_at" IS NULL AND "event_lifecycle_history"."reason" IS NULL AND "event_lifecycle_history"."cancellation_retention_until" IS NULL)
      OR ("event_lifecycle_history"."from_lifecycle" = 'published' AND "event_lifecycle_history"."to_lifecycle" = 'postponed' AND "event_lifecycle_history"."postponed_from_starts_at" IS NOT NULL AND "event_lifecycle_history"."reason" IS NOT NULL AND char_length(btrim("event_lifecycle_history"."reason")) > 0 AND char_length("event_lifecycle_history"."reason") <= 500 AND "event_lifecycle_history"."cancellation_retention_until" IS NULL)
      OR ("event_lifecycle_history"."from_lifecycle" = 'postponed' AND "event_lifecycle_history"."to_lifecycle" = 'published' AND "event_lifecycle_history"."postponed_from_starts_at" IS NULL AND "event_lifecycle_history"."reason" IS NULL AND "event_lifecycle_history"."cancellation_retention_until" IS NULL)
      OR ("event_lifecycle_history"."from_lifecycle" IN ('published', 'postponed') AND "event_lifecycle_history"."to_lifecycle" = 'cancelled' AND "event_lifecycle_history"."postponed_from_starts_at" IS NULL AND "event_lifecycle_history"."reason" IS NOT NULL AND char_length(btrim("event_lifecycle_history"."reason")) > 0 AND char_length("event_lifecycle_history"."reason") <= 500 AND "event_lifecycle_history"."cancellation_retention_until" IS NOT NULL)
    ))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancellation_retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" ADD CONSTRAINT "event_lifecycle_history_event_same_tenant_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "event_lifecycle_history_tenant_event_sequence" ON "event_lifecycle_history" USING btree ("tenant_id","event_id","sequence");--> statement-breakpoint
CREATE INDEX "event_lifecycle_history_tenant_occurred_at" ON "event_lifecycle_history" USING btree ("tenant_id","occurred_at");--> statement-breakpoint

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_closed";--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated', 'fixture.created', 'fixture.changed', 'fixture.postponed', 'fixture.cancelled', 'fixture.completed', 'fixture.abandoned', 'result.draft_created', 'result.draft_changed', 'result.published', 'result.corrected', 'event.created', 'event.changed', 'event.published', 'event.postponed', 'event.republished', 'event.cancelled', 'organiser.created', 'organiser.changed'));--> statement-breakpoint

-- The current runtime role may append/read history but cannot rewrite it.
CREATE OR REPLACE FUNCTION "public"."event_lifecycle_history_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event_lifecycle_history is append-only; % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "event_lifecycle_history_reject_row_mutation"
BEFORE UPDATE OR DELETE ON "event_lifecycle_history"
FOR EACH ROW
EXECUTE FUNCTION "public"."event_lifecycle_history_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "event_lifecycle_history_reject_truncate"
BEFORE TRUNCATE ON "event_lifecycle_history"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."event_lifecycle_history_reject_mutation"();--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_audit_owner') THEN
    CREATE ROLE campushub_audit_owner NOLOGIN;
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" OWNER TO "campushub_audit_owner";--> statement-breakpoint
REVOKE ALL ON TABLE "event_lifecycle_history" FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "event_lifecycle_history" TO "campushub_runtime";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "event_lifecycle_history" FROM "campushub_runtime";--> statement-breakpoint

-- CH-EVT-004 migration phase 3: bootstrap only unambiguous published Events
-- from the existing publication audit timestamp. No synthetic facts or draft
-- baselines are created.
INSERT INTO "event_lifecycle_history" (
  "tenant_id", "event_id", "sequence", "event_version", "from_lifecycle",
  "to_lifecycle", "starts_at", "ends_at", "postponed_from_starts_at",
  "reason", "cancellation_retention_until", "occurred_at"
)
SELECT
  event_row.tenant_id,
  event_row.id,
  1,
  event_row.version,
  'draft',
  'published',
  event_row.starts_at,
  event_row.ends_at,
  NULL,
  NULL,
  NULL,
  audit_row.occurred_at
FROM public.events AS event_row
JOIN public.audit_events AS audit_row
  ON audit_row.tenant_id = event_row.tenant_id
 AND audit_row.event_type = 'event.published'
 AND audit_row.resource_type = 'event'
 AND audit_row.resource_id = event_row.id
 AND audit_row.resource_version = event_row.version
 AND audit_row.event_facts->>'action' = 'published'
 AND audit_row.event_facts->>'lifecycle' = 'published'
 AND audit_row.event_facts->>'version' ~ '^[0-9]+$'
 AND (audit_row.event_facts->>'version')::integer = event_row.version
WHERE event_row.lifecycle = 'published';--> statement-breakpoint

-- CH-EVT-004 migration phase 4: verify complete bootstrap before success.
DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_count
  FROM public.events AS event_row
  WHERE (event_row.lifecycle = 'published' AND (
    SELECT count(*) FROM public.event_lifecycle_history AS history
    WHERE history.tenant_id = event_row.tenant_id
      AND history.event_id = event_row.id
  ) <> 1)
     OR (event_row.lifecycle = 'draft' AND EXISTS (
    SELECT 1 FROM public.event_lifecycle_history AS history
    WHERE history.tenant_id = event_row.tenant_id
      AND history.event_id = event_row.id
  ));

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'CH-EVT-004 history bootstrap postcondition failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_lifecycle_history AS history
    LEFT JOIN public.events AS event_row
      ON event_row.tenant_id = history.tenant_id
     AND event_row.id = history.event_id
    WHERE event_row.id IS NULL
  ) THEN
    RAISE EXCEPTION 'CH-EVT-004 history contains a foreign or missing Event relation';
  END IF;
END;
$$;--> statement-breakpoint

-- Phase 5 is exercised by the repository's isolated PostgreSQL migration
-- integration tests; every statement above remains in the normal Drizzle
-- migration transaction and any failed preflight/postcondition aborts it.
