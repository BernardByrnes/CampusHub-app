CREATE TYPE "public"."event_rsvp_operation_family" AS ENUM('participation');--> statement-breakpoint
CREATE TYPE "public"."event_rsvp_state" AS ENUM('going', 'interested', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."event_rsvp_outcome" AS ENUM('CHANGED', 'NOOP');--> statement-breakpoint
CREATE TYPE "public"."tenant_module_scope" AS ENUM('publication', 'event', 'opportunity', 'sports', 'poll', 'voice', 'quiz', 'sponsorship', 'tenant', 'verification', 'analytics', 'notification', 'export', 'search');--> statement-breakpoint
CREATE TABLE "event_rsvp_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"operation_family" "event_rsvp_operation_family" NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_state" "event_rsvp_state" NOT NULL,
	"expected_participation_version" integer NOT NULL,
	"completed_outcome" "event_rsvp_outcome",
	"completed_state" "event_rsvp_state",
	"completed_participation_version" integer,
	"completed_changed" boolean,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvp_idempotency_identity_unique" UNIQUE("tenant_id","event_id","membership_id","operation_family","idempotency_key"),
	CONSTRAINT "event_rsvp_idempotency_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "event_rsvp_idempotency_key_nonempty" CHECK (char_length(btrim("event_rsvp_idempotency"."idempotency_key")) > 0 AND char_length("event_rsvp_idempotency"."idempotency_key") <= 200),
	CONSTRAINT "event_rsvp_idempotency_expected_version_nonnegative" CHECK ("event_rsvp_idempotency"."expected_participation_version" >= 0),
	CONSTRAINT "event_rsvp_idempotency_completion_shape" CHECK ((
	        ("event_rsvp_idempotency"."completed_outcome" IS NULL AND "event_rsvp_idempotency"."completed_state" IS NULL AND "event_rsvp_idempotency"."completed_participation_version" IS NULL AND "event_rsvp_idempotency"."completed_changed" IS NULL AND "event_rsvp_idempotency"."completed_at" IS NULL)
	        OR (
	          "event_rsvp_idempotency"."completed_outcome" IS NOT NULL AND
	          "event_rsvp_idempotency"."completed_state" IS NOT NULL AND
	          "event_rsvp_idempotency"."completed_participation_version" IS NOT NULL AND
	          "event_rsvp_idempotency"."completed_participation_version" >= 1 AND
	          "event_rsvp_idempotency"."completed_changed" IS NOT NULL AND
	          "event_rsvp_idempotency"."completed_at" IS NOT NULL AND
	          (("event_rsvp_idempotency"."completed_outcome" = 'CHANGED' AND "event_rsvp_idempotency"."completed_changed" = true)
	           OR ("event_rsvp_idempotency"."completed_outcome" = 'NOOP' AND "event_rsvp_idempotency"."completed_changed" = false))
	        )
      ))
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"state" "event_rsvp_state" NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_tenant_event_membership_unique" UNIQUE("tenant_id","event_id","membership_id"),
	CONSTRAINT "event_rsvps_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "event_rsvps_version_positive" CHECK ("event_rsvps"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "tenant_module_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" "tenant_module_scope" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_module_states_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_module_states_version_positive" CHECK ("tenant_module_states"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_rsvp_idempotency" ADD CONSTRAINT "event_rsvp_idempotency_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_rsvp_idempotency" ADD CONSTRAINT "event_rsvp_idempotency_event_same_tenant_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_rsvp_idempotency" ADD CONSTRAINT "event_rsvp_idempotency_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_same_tenant_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenant_module_states" ADD CONSTRAINT "tenant_module_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "event_rsvp_idempotency_tenant_event_membership" ON "event_rsvp_idempotency" USING btree ("tenant_id","event_id","membership_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_tenant_event_state" ON "event_rsvps" USING btree ("tenant_id","event_id","state");--> statement-breakpoint
CREATE INDEX "event_rsvps_tenant_membership" ON "event_rsvps" USING btree ("tenant_id","membership_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_module_states_tenant_module_unique" ON "tenant_module_states" USING btree ("tenant_id","module");--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_data_owner') THEN
    CREATE ROLE campushub_data_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_runtime') THEN
    CREATE ROLE campushub_runtime NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "tenant_module_states" OWNER TO "campushub_data_owner";--> statement-breakpoint
ALTER TABLE "event_rsvps" OWNER TO "campushub_data_owner";--> statement-breakpoint
ALTER TABLE "event_rsvp_idempotency" OWNER TO "campushub_data_owner";--> statement-breakpoint

REVOKE ALL ON TABLE "tenant_module_states", "event_rsvps", "event_rsvp_idempotency" FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON TABLE "tenant_module_states" TO "campushub_runtime";--> statement-breakpoint
GRANT UPDATE ("updated_at") ON TABLE "tenant_module_states" TO "campushub_runtime";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "event_rsvps", "event_rsvp_idempotency" TO "campushub_runtime";--> statement-breakpoint
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "tenant_module_states" FROM "campushub_runtime";--> statement-breakpoint
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "event_rsvps", "event_rsvp_idempotency" FROM "campushub_runtime";--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."tenant_module_states_reject_runtime_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM pg_roles
       WHERE rolname = current_user
         AND (rolsuper OR rolcreaterole)
     )
     OR EXISTS (
       SELECT 1
       FROM pg_class
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       JOIN pg_roles ON pg_roles.oid = pg_class.relowner
       WHERE pg_namespace.nspname = 'public'
         AND pg_class.relname = 'tenant_module_states'
         AND pg_roles.rolname = current_user
     ) THEN
    RETURN NEW;
  END IF;
  IF pg_has_role(current_user, 'campushub_runtime', 'USAGE') THEN
    RAISE EXCEPTION 'tenant_module_states is not runtime-mutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tenant_module_states_reject_runtime_update"
BEFORE UPDATE ON "tenant_module_states"
FOR EACH ROW
EXECUTE FUNCTION "public"."tenant_module_states_reject_runtime_update"();--> statement-breakpoint

INSERT INTO "tenant_module_states" ("tenant_id", "module", "enabled", "version")
SELECT "id", 'event', true, 1
FROM "tenants"
ON CONFLICT ("tenant_id", "module") DO NOTHING;
