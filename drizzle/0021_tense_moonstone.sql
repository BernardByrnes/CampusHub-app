CREATE TYPE "public"."xp_ledger_entry_type" AS ENUM('award', 'capped_award', 'correction', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."xp_source_kind" AS ENUM('verification_completion', 'profile_field_completion', 'poll_participation', 'event_rsvp', 'daily_quiz_participation', 'daily_quiz_accuracy', 'streak_milestone');--> statement-breakpoint
CREATE TABLE "xp_event_rsvp_source_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_claim_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_event_rsvp_source_claims_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "xp_event_rsvp_source_claims_tenant_claim_unique" UNIQUE("tenant_id","source_claim_id"),
	CONSTRAINT "xp_event_rsvp_source_claims_tenant_event_unique" UNIQUE("tenant_id","event_id","source_claim_id")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"entry_type" "xp_ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"source_kind" "xp_source_kind" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"source_occurrence" text NOT NULL,
	"source_claim_id" uuid,
	"request_idempotency_key_digest" text,
	"reason_code" text,
	"reason_text" text,
	"source_entry_id" uuid,
	"actor_membership_id" uuid,
	"adjustment_intent_id" uuid,
	"tenant_day" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_entries_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "xp_ledger_entries_tenant_membership_id_unique" UNIQUE("tenant_id","membership_id","id"),
	CONSTRAINT "xp_ledger_entries_reciprocal_unique" UNIQUE("tenant_id","source_claim_id","membership_id","id","entry_type","rule_id","rule_version","source_kind","source_reference_id","source_occurrence"),
	CONSTRAINT "xp_ledger_entries_tenant_adjustment_intent_unique" UNIQUE("tenant_id","adjustment_intent_id"),
	CONSTRAINT "xp_ledger_entries_amount_shape" CHECK ((
        ("xp_ledger_entries"."entry_type" = 'award' AND "xp_ledger_entries"."amount" > 0 AND "xp_ledger_entries"."source_claim_id" IS NOT NULL AND "xp_ledger_entries"."reason_code" IS NULL AND "xp_ledger_entries"."reason_text" IS NULL AND "xp_ledger_entries"."source_entry_id" IS NULL AND "xp_ledger_entries"."actor_membership_id" IS NULL)
        OR ("xp_ledger_entries"."entry_type" = 'capped_award' AND "xp_ledger_entries"."amount" = 0 AND "xp_ledger_entries"."source_claim_id" IS NOT NULL AND "xp_ledger_entries"."reason_code" IS NULL AND "xp_ledger_entries"."reason_text" IS NULL AND "xp_ledger_entries"."source_entry_id" IS NULL AND "xp_ledger_entries"."actor_membership_id" IS NULL)
        OR ("xp_ledger_entries"."entry_type" = 'correction' AND "xp_ledger_entries"."amount" > 0 AND "xp_ledger_entries"."source_claim_id" IS NULL AND "xp_ledger_entries"."reason_code" IS NOT NULL AND char_length(btrim("xp_ledger_entries"."reason_code")) > 0 AND "xp_ledger_entries"."reason_text" IS NOT NULL AND char_length(btrim("xp_ledger_entries"."reason_text")) > 0 AND "xp_ledger_entries"."source_entry_id" IS NOT NULL AND "xp_ledger_entries"."actor_membership_id" IS NOT NULL)
        OR ("xp_ledger_entries"."entry_type" = 'reversal' AND "xp_ledger_entries"."amount" < 0 AND "xp_ledger_entries"."source_claim_id" IS NULL AND "xp_ledger_entries"."reason_code" IS NOT NULL AND char_length(btrim("xp_ledger_entries"."reason_code")) > 0 AND "xp_ledger_entries"."reason_text" IS NOT NULL AND char_length(btrim("xp_ledger_entries"."reason_text")) > 0 AND "xp_ledger_entries"."source_entry_id" IS NOT NULL AND "xp_ledger_entries"."actor_membership_id" IS NOT NULL)
      )),
	CONSTRAINT "xp_ledger_entries_adjustment_intent_shape" CHECK ((
		("xp_ledger_entries"."entry_type" IN ('award', 'capped_award') AND "xp_ledger_entries"."adjustment_intent_id" IS NULL)
		OR ("xp_ledger_entries"."entry_type" IN ('correction', 'reversal') AND "xp_ledger_entries"."adjustment_intent_id" IS NOT NULL)
	)),
	CONSTRAINT "xp_ledger_entries_rule_shape" CHECK ("xp_ledger_entries"."rule_id" IN ('verification.complete', 'profile.field', 'poll.participation', 'event.rsvp', 'quiz.participation', 'quiz.accuracy', 'streak.milestone') AND "xp_ledger_entries"."rule_version" >= 1),
	CONSTRAINT "xp_ledger_entries_source_occurrence_nonempty" CHECK (char_length(btrim("xp_ledger_entries"."source_occurrence")) > 0 AND char_length("xp_ledger_entries"."source_occurrence") <= 120),
	CONSTRAINT "xp_ledger_entries_request_digest_shape" CHECK ("xp_ledger_entries"."request_idempotency_key_digest" IS NULL OR "xp_ledger_entries"."request_idempotency_key_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "xp_ledger_entries_reason_text_bound" CHECK ("xp_ledger_entries"."reason_text" IS NULL OR char_length("xp_ledger_entries"."reason_text") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "xp_source_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"source_kind" "xp_source_kind" NOT NULL,
	"source_reference_id" uuid NOT NULL,
	"source_occurrence" text NOT NULL,
	"expected_entry_type" "xp_ledger_entry_type" NOT NULL,
	"canonical_ledger_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_source_claims_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "xp_source_claims_tenant_canonical_ledger_unique" UNIQUE("tenant_id","canonical_ledger_entry_id"),
	CONSTRAINT "xp_source_claims_conceptual_source_unique" UNIQUE("tenant_id","membership_id","rule_id","source_kind","source_reference_id","source_occurrence"),
	CONSTRAINT "xp_source_claims_reciprocal_unique" UNIQUE("tenant_id","id","membership_id","canonical_ledger_entry_id","expected_entry_type","rule_id","rule_version","source_kind","source_reference_id","source_occurrence"),
	CONSTRAINT "xp_source_claims_rule_shape" CHECK ("xp_source_claims"."rule_id" IN ('verification.complete', 'profile.field', 'poll.participation', 'event.rsvp', 'quiz.participation', 'quiz.accuracy', 'streak.milestone') AND "xp_source_claims"."rule_version" >= 1),
	CONSTRAINT "xp_source_claims_source_occurrence_nonempty" CHECK (char_length(btrim("xp_source_claims"."source_occurrence")) > 0 AND char_length("xp_source_claims"."source_occurrence") <= 120),
	CONSTRAINT "xp_source_claims_event_rsvp_shape" CHECK (("xp_source_claims"."source_kind" <> 'event_rsvp' OR ("xp_source_claims"."rule_id" = 'event.rsvp' AND "xp_source_claims"."source_occurrence" = 'initial_eligible_rsvp')))
	,
	CONSTRAINT "xp_source_claims_expected_entry_type_shape" CHECK ("xp_source_claims"."expected_entry_type" IN ('award', 'capped_award'))
);
--> statement-breakpoint
ALTER TABLE "xp_event_rsvp_source_claims" ADD CONSTRAINT "xp_event_rsvp_source_claims_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_event_rsvp_source_claims" ADD CONSTRAINT "xp_event_rsvp_source_claims_claim_same_tenant_fk" FOREIGN KEY ("tenant_id","source_claim_id") REFERENCES "public"."xp_source_claims"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_event_rsvp_source_claims" ADD CONSTRAINT "xp_event_rsvp_source_claims_event_same_tenant_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_actor_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_ledger_entries" ADD CONSTRAINT "xp_ledger_entries_source_same_tenant_membership_fk" FOREIGN KEY ("tenant_id","membership_id","source_entry_id") REFERENCES "public"."xp_ledger_entries"("tenant_id","membership_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_source_claims" ADD CONSTRAINT "xp_source_claims_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "xp_source_claims" ADD CONSTRAINT "xp_source_claims_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "xp_ledger_entries_tenant_membership_day" ON "xp_ledger_entries" USING btree ("tenant_id","membership_id","tenant_day","id");--> statement-breakpoint
CREATE INDEX "xp_ledger_entries_tenant_membership_occurred" ON "xp_ledger_entries" USING btree ("tenant_id","membership_id","occurred_at");--> statement-breakpoint
CREATE INDEX "xp_source_claims_tenant_membership" ON "xp_source_claims" USING btree ("tenant_id","membership_id","created_at");
--> statement-breakpoint

-- Ordinary source claims and ledger facts are a reciprocal, commit-time pair.
-- Both rows carry the same Tenant, Membership, rule, source, occurrence and
-- expected outcome. The constraints are deferred so the runtime can insert
-- the preallocated claim, typed source relation, and ledger row in one unit.
ALTER TABLE "xp_source_claims"
  ADD CONSTRAINT "xp_source_claims_canonical_ledger_pair_fk"
  FOREIGN KEY ("tenant_id", "id", "membership_id", "canonical_ledger_entry_id", "expected_entry_type", "rule_id", "rule_version", "source_kind", "source_reference_id", "source_occurrence")
  REFERENCES "public"."xp_ledger_entries" ("tenant_id", "source_claim_id", "membership_id", "id", "entry_type", "rule_id", "rule_version", "source_kind", "source_reference_id", "source_occurrence")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

ALTER TABLE "xp_ledger_entries"
  ADD CONSTRAINT "xp_ledger_entries_source_claim_pair_fk"
  FOREIGN KEY ("tenant_id", "source_claim_id", "membership_id", "id", "entry_type", "rule_id", "rule_version", "source_kind", "source_reference_id", "source_occurrence")
  REFERENCES "public"."xp_source_claims" ("tenant_id", "id", "membership_id", "canonical_ledger_entry_id", "expected_entry_type", "rule_id", "rule_version", "source_kind", "source_reference_id", "source_occurrence")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."xp_event_rsvp_source_claim_shape"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  claim_row record;
BEGIN
  SELECT rule_id, source_kind, source_reference_id, source_occurrence
    INTO claim_row
    FROM public.xp_source_claims
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.source_claim_id;

  IF NOT FOUND
     OR claim_row.rule_id <> 'event.rsvp'
     OR claim_row.source_kind <> 'event_rsvp'
     OR claim_row.source_reference_id <> NEW.event_id
     OR claim_row.source_occurrence <> 'initial_eligible_rsvp' THEN
    RAISE EXCEPTION 'xp_event_rsvp_source_claims does not match its typed Event RSVP claim'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "xp_event_rsvp_source_claims_shape"
BEFORE INSERT OR UPDATE ON "xp_event_rsvp_source_claims"
FOR EACH ROW
EXECUTE FUNCTION "public"."xp_event_rsvp_source_claim_shape"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."xp_event_rsvp_claim_requires_typed_source"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_kind = 'event_rsvp'
     AND NOT EXISTS (
       SELECT 1
       FROM public.xp_event_rsvp_source_claims AS source
       WHERE source.tenant_id = NEW.tenant_id
         AND source.source_claim_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'event_rsvp source claim requires a typed Event source relation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "xp_source_claims_typed_event_source_required"
AFTER INSERT OR UPDATE ON "xp_source_claims"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."xp_event_rsvp_claim_requires_typed_source"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."xp_ledger_entries_validate_corrective_shape"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row record;
BEGIN
  IF NEW.entry_type IN ('correction', 'reversal') THEN
    IF current_user = 'campushub_runtime'
       OR (
         NOT EXISTS (
           SELECT 1
           FROM pg_roles
           WHERE rolname = current_user
             AND rolsuper
         )
         AND pg_has_role(current_user, 'campushub_runtime', 'MEMBER')
       ) THEN
      RAISE EXCEPTION 'ordinary runtime cannot insert corrective XP ledger facts'
        USING ERRCODE = '42501';
    END IF;

    SELECT tenant_id, membership_id, entry_type, source_claim_id, rule_id,
           rule_version, source_kind, source_reference_id, source_occurrence
      INTO source_row
       FROM public.xp_ledger_entries
      WHERE tenant_id = NEW.tenant_id
        AND membership_id = NEW.membership_id
        AND id = NEW.source_entry_id
      FOR UPDATE;

    IF NOT FOUND
       OR source_row.entry_type::text NOT IN ('award', 'capped_award')
       OR source_row.source_claim_id IS NULL
       OR source_row.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR source_row.membership_id IS DISTINCT FROM NEW.membership_id
       OR source_row.rule_id IS DISTINCT FROM NEW.rule_id
       OR source_row.rule_version IS DISTINCT FROM NEW.rule_version
       OR source_row.source_kind IS DISTINCT FROM NEW.source_kind
       OR source_row.source_reference_id IS DISTINCT FROM NEW.source_reference_id
       OR source_row.source_occurrence IS DISTINCT FROM NEW.source_occurrence THEN
      RAISE EXCEPTION 'corrective XP ledger fact must reference a matching ordinary source fact'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "xp_ledger_entries_validate_corrective_shape"
BEFORE INSERT OR UPDATE ON "xp_ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION "public"."xp_ledger_entries_validate_corrective_shape"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."xp_immutable_row_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "xp_ledger_entries_reject_row_mutation"
BEFORE UPDATE OR DELETE ON "xp_ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION "public"."xp_immutable_row_reject_mutation"();--> statement-breakpoint

CREATE TRIGGER "xp_source_claims_reject_row_mutation"
BEFORE UPDATE OR DELETE ON "xp_source_claims"
FOR EACH ROW
EXECUTE FUNCTION "public"."xp_immutable_row_reject_mutation"();--> statement-breakpoint

CREATE TRIGGER "xp_event_rsvp_source_claims_reject_row_mutation"
BEFORE UPDATE OR DELETE ON "xp_event_rsvp_source_claims"
FOR EACH ROW
EXECUTE FUNCTION "public"."xp_immutable_row_reject_mutation"();--> statement-breakpoint

CREATE TRIGGER "xp_ledger_entries_reject_truncate"
BEFORE TRUNCATE ON "xp_ledger_entries"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."xp_immutable_row_reject_mutation"();--> statement-breakpoint

CREATE TRIGGER "xp_source_claims_reject_truncate"
BEFORE TRUNCATE ON "xp_source_claims"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."xp_immutable_row_reject_mutation"();--> statement-breakpoint

CREATE TRIGGER "xp_event_rsvp_source_claims_reject_truncate"
BEFORE TRUNCATE ON "xp_event_rsvp_source_claims"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."xp_immutable_row_reject_mutation"();--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_data_owner') THEN
    CREATE ROLE campushub_data_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_runtime') THEN
    CREATE ROLE campushub_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_rsvp_lock_owner') THEN
    CREATE ROLE campushub_rsvp_lock_owner NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "xp_ledger_entries" OWNER TO "campushub_data_owner";--> statement-breakpoint
ALTER TABLE "xp_source_claims" OWNER TO "campushub_data_owner";--> statement-breakpoint
ALTER TABLE "xp_event_rsvp_source_claims" OWNER TO "campushub_data_owner";--> statement-breakpoint

REVOKE ALL ON TABLE "xp_ledger_entries", "xp_source_claims", "xp_event_rsvp_source_claims" FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "xp_ledger_entries", "xp_source_claims", "xp_event_rsvp_source_claims" TO "campushub_runtime";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "xp_ledger_entries", "xp_source_claims", "xp_event_rsvp_source_claims" FROM "campushub_runtime";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "tenants", "memberships", "events" FROM "campushub_runtime";--> statement-breakpoint
REVOKE TRIGGER ON TABLE "tenant_module_states", "event_rsvps", "event_rsvp_idempotency" FROM "campushub_runtime";--> statement-breakpoint

GRANT SELECT ON TABLE "tenants", "memberships", "events" TO "campushub_rsvp_lock_owner";--> statement-breakpoint
GRANT UPDATE ("id") ON TABLE "tenants", "memberships", "events" TO "campushub_rsvp_lock_owner";--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."campushub_rsvp_lock_tenant"(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM public.tenants
  WHERE public.tenants.id = p_tenant_id
  FOR SHARE;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."campushub_rsvp_lock_membership"(p_tenant_id uuid, p_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM public.memberships
  WHERE public.memberships.tenant_id = p_tenant_id
    AND public.memberships.id = p_membership_id
  FOR SHARE;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."campushub_rsvp_lock_event"(p_tenant_id uuid, p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM public.events
  WHERE public.events.tenant_id = p_tenant_id
    AND public.events.id = p_event_id
  FOR SHARE;
END
$$;--> statement-breakpoint

ALTER FUNCTION "public"."campushub_rsvp_lock_tenant"(uuid) OWNER TO "campushub_rsvp_lock_owner";--> statement-breakpoint
ALTER FUNCTION "public"."campushub_rsvp_lock_membership"(uuid, uuid) OWNER TO "campushub_rsvp_lock_owner";--> statement-breakpoint
ALTER FUNCTION "public"."campushub_rsvp_lock_event"(uuid, uuid) OWNER TO "campushub_rsvp_lock_owner";--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."campushub_rsvp_lock_tenant"(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."campushub_rsvp_lock_membership"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."campushub_rsvp_lock_event"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."campushub_rsvp_lock_tenant"(uuid) TO "campushub_runtime";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."campushub_rsvp_lock_membership"(uuid, uuid) TO "campushub_runtime";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."campushub_rsvp_lock_event"(uuid, uuid) TO "campushub_runtime";
