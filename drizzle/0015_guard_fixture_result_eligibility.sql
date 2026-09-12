CREATE OR REPLACE FUNCTION "results_require_completed_fixture"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_fixture_state "fixture_state";
BEGIN
  SELECT fixture.state
  INTO current_fixture_state
  FROM "fixtures" AS fixture
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
CREATE OR REPLACE FUNCTION "fixtures_reject_result_ineligible_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'completed' THEN
    PERFORM 1
    FROM "results" AS result
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
CREATE TRIGGER "fixtures_reject_result_ineligible_transition_trigger"
BEFORE UPDATE OF state ON "fixtures"
FOR EACH ROW
EXECUTE FUNCTION "fixtures_reject_result_ineligible_transition"();
