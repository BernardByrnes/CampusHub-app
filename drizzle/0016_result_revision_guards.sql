-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION "public"."results_require_completed_fixture"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_fixture_state "public"."fixture_state";
BEGIN
  SELECT fixture.state
  INTO current_fixture_state
  FROM "public"."fixtures" AS fixture
  WHERE fixture.tenant_id = NEW.tenant_id
    AND fixture.id = NEW.fixture_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Result requires a same-Tenant Fixture'
      USING ERRCODE = '23503';
  END IF;

  IF current_fixture_state <> 'completed' THEN
    RAISE EXCEPTION 'Result requires a completed Fixture'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."fixtures_reject_result_ineligible_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'completed' THEN
    PERFORM 1
    FROM "public"."results" AS result
    WHERE result.tenant_id = NEW.tenant_id
      AND result.fixture_id = NEW.id
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'Fixture with an attached Result must remain completed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."results_preserve_published_lineage"()
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
    OR NEW.current_revision_number IS DISTINCT FROM OLD.current_revision_number + 1
    OR NEW.created_at <> OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Published Result aggregate is immutable except for its next revision pointer'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."result_revisions_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'result_revisions is append-only; % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."results_require_published_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lifecycle = 'published'
    AND (
      TG_OP = 'INSERT'
      OR OLD.lifecycle = 'draft'
    )
    AND NEW.current_revision_number IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'initial publication requires revision 1'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lifecycle = 'published' AND NOT EXISTS (
    SELECT 1
    FROM "public"."result_revisions" AS revision
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
CREATE OR REPLACE FUNCTION "public"."result_revision_requires_published_result"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.revision_number > 1 AND NOT EXISTS (
    SELECT 1
    FROM "public"."result_revisions" AS predecessor
    WHERE predecessor.tenant_id = NEW.tenant_id
      AND predecessor.result_id = NEW.result_id
      AND predecessor.revision_number = NEW.revision_number - 1
  ) THEN
    RAISE EXCEPTION 'Result revisions must form a contiguous sequence'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."results" AS result
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
$$;
