CREATE TYPE "public"."result_lifecycle" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "result_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"correction_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_revisions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "result_revisions_result_revision_unique" UNIQUE("tenant_id","result_id","revision_number"),
	CONSTRAINT "result_revisions_revision_positive" CHECK ("result_revisions"."revision_number" >= 1),
	CONSTRAINT "result_revisions_home_score_nonnegative" CHECK ("result_revisions"."home_score" >= 0 AND "result_revisions"."home_score" <= 1000),
	CONSTRAINT "result_revisions_away_score_nonnegative" CHECK ("result_revisions"."away_score" >= 0 AND "result_revisions"."away_score" <= 1000),
	CONSTRAINT "result_revisions_reason_shape" CHECK ((
        ("result_revisions"."revision_number" = 1 AND "result_revisions"."correction_reason" IS NULL)
        OR
        ("result_revisions"."revision_number" > 1
          AND "result_revisions"."correction_reason" IS NOT NULL
          AND char_length(btrim("result_revisions"."correction_reason")) > 0
          AND char_length("result_revisions"."correction_reason") <= 500)
      ))
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fixture_id" uuid NOT NULL,
	"lifecycle" "result_lifecycle" DEFAULT 'draft' NOT NULL,
	"draft_home_score" integer,
	"draft_away_score" integer,
	"current_revision_number" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "results_one_per_fixture" UNIQUE("tenant_id","fixture_id"),
	CONSTRAINT "results_draft_scores_shape" CHECK ((
        ("results"."lifecycle" = 'draft'
          AND "results"."draft_home_score" IS NOT NULL
          AND "results"."draft_away_score" IS NOT NULL
          AND "results"."current_revision_number" IS NULL)
        OR
        ("results"."lifecycle" = 'published'
          AND "results"."draft_home_score" IS NULL
          AND "results"."draft_away_score" IS NULL
          AND "results"."current_revision_number" >= 1)
      )),
	CONSTRAINT "results_scores_nonnegative" CHECK ("results"."draft_home_score" IS NULL OR ("results"."draft_home_score" >= 0 AND "results"."draft_home_score" <= 1000)),
	CONSTRAINT "results_away_score_nonnegative" CHECK ("results"."draft_away_score" IS NULL OR ("results"."draft_away_score" >= 0 AND "results"."draft_away_score" <= 1000)),
	CONSTRAINT "results_version_positive" CHECK ("results"."version" >= 1),
	CONSTRAINT "results_current_revision_positive" CHECK ("results"."current_revision_number" IS NULL OR "results"."current_revision_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_event_type_closed";--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_resource_type_closed";--> statement-breakpoint
ALTER TABLE "result_revisions" ADD CONSTRAINT "result_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "result_revisions" ADD CONSTRAINT "result_revisions_result_same_tenant_fk" FOREIGN KEY ("tenant_id","result_id") REFERENCES "public"."results"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "result_revisions" ADD CONSTRAINT "result_revisions_actor_same_tenant_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_fixture_same_tenant_fk" FOREIGN KEY ("tenant_id","fixture_id") REFERENCES "public"."fixtures"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "result_revisions_tenant_result" ON "result_revisions" USING btree ("tenant_id","result_id","revision_number");--> statement-breakpoint
CREATE INDEX "results_tenant_lifecycle" ON "results" USING btree ("tenant_id","lifecycle");--> statement-breakpoint
CREATE INDEX "results_tenant_fixture" ON "results" USING btree ("tenant_id","fixture_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated', 'fixture.created', 'fixture.changed', 'fixture.postponed', 'fixture.cancelled', 'fixture.completed', 'fixture.abandoned', 'result.draft_created', 'result.draft_changed', 'result.published', 'result.corrected'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_resource_type_closed" CHECK ("audit_events"."resource_type" IN ('publication', 'sport', 'competition', 'team', 'fixture', 'result'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "results_require_completed_fixture"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "fixtures" AS fixture
    WHERE fixture.tenant_id = NEW.tenant_id
      AND fixture.id = NEW.fixture_id
      AND fixture.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'Result requires a completed Fixture'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "results_require_completed_fixture_trigger"
BEFORE INSERT OR UPDATE ON "results"
FOR EACH ROW
EXECUTE FUNCTION "results_require_completed_fixture"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "results_preserve_published_lineage"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Result version must advance exactly once'
      USING ERRCODE = '40001';
  END IF;
  IF OLD.lifecycle = 'published' AND (
    NEW.lifecycle <> 'published'
    OR NEW.tenant_id <> OLD.tenant_id
    OR NEW.fixture_id <> OLD.fixture_id
    OR NEW.draft_home_score IS NOT NULL
    OR NEW.draft_away_score IS NOT NULL
    OR NEW.current_revision_number IS NULL
    OR NEW.current_revision_number < OLD.current_revision_number
    OR NEW.created_at <> OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Published Result aggregate is immutable except for its next revision pointer'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "results_preserve_published_lineage_trigger"
BEFORE UPDATE ON "results"
FOR EACH ROW
EXECUTE FUNCTION "results_preserve_published_lineage"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "result_revisions_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'result_revisions is append-only; % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "result_revisions_reject_row_mutation"
BEFORE UPDATE OR DELETE ON "result_revisions"
FOR EACH ROW
EXECUTE FUNCTION "result_revisions_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "result_revisions_reject_truncate"
BEFORE TRUNCATE ON "result_revisions"
FOR EACH STATEMENT
EXECUTE FUNCTION "result_revisions_reject_mutation"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "results_require_published_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lifecycle = 'published' AND NOT EXISTS (
    SELECT 1
    FROM "result_revisions" AS revision
    WHERE revision.tenant_id = NEW.tenant_id
      AND revision.result_id = NEW.id
      AND revision.revision_number = NEW.current_revision_number
  ) THEN
    RAISE EXCEPTION 'published Result requires its immutable current revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "results_require_published_revision_trigger"
BEFORE INSERT OR UPDATE ON "results"
FOR EACH ROW
EXECUTE FUNCTION "results_require_published_revision"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "result_revision_requires_published_result"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "results" AS result
    WHERE result.tenant_id = NEW.tenant_id
      AND result.id = NEW.result_id
      AND result.lifecycle = 'published'
      AND result.current_revision_number = NEW.revision_number
  ) THEN
    RAISE EXCEPTION 'ResultRevision requires the matching published Result pointer'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "result_revision_requires_published_result_trigger"
AFTER INSERT ON "result_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "result_revision_requires_published_result"();
